// The company popup's Email Campaign control: which saved campaigns have
// this company on their "add someone from" list, and a picker to put it on
// another.
//
// Adding the company adds NOBODY to the campaign. It leaves a placeholder on
// the campaign tracker saying somebody from this company should be added
// (utils/campaignTargetCompanies.js), which fills once a contact there is on
// the roster. Picking the person stays a decision made on the campaign.
//
// Self-contained the same way ContactCampaignAdd is: it reads the saved
// campaigns (emailCampaigns/{uid}) itself and writes the add back after a
// fresh read, so an edit made elsewhere in the meantime isn't lost.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { primarySubject } from '../../utils/campaignSubjects';
import { addTargetCompany, campaignHasTargetCompany, targetCompanyStatus } from '../../utils/campaignTargetCompanies';
import { companiesMatch } from '../../utils/listFlags';
import { campaignsByRecency, campaignPickerDetail } from '../../utils/campaignPicker';
import { CampaignPicker } from '../common/CampaignPicker';
import { EMAIL_CAMPAIGNS_UPDATED_EVENT } from './ContactCampaignAdd';

const campaignLabel = (c) => c?.title || primarySubject(c) || '(untitled campaign)';

export function CompanyCampaignAdd({ company }) {
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

  const name = String(company || '').trim();
  const entries = useMemo(() => campaignsByRecency(campaigns).map(({ campaign: c, index }) => {
    const on = !!name && campaignHasTargetCompany(c, name);
    // Filled once somebody at the company is on that campaign's roster.
    const filled = on && targetCompanyStatus(c).some(t => companiesMatch(t.company, name) && !t.open);
    return { index, label: campaignLabel(c), on, filled, c };
  }), [campaigns, name]);
  const onCampaigns = useMemo(() => entries.filter(e => e.on), [entries]);
  const offCampaigns = useMemo(() => entries.filter(e => !e.on), [entries]);
  const pickerOptions = useMemo(() => offCampaigns.map(e => ({
    key: String(e.index),
    label: e.label,
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
      const key = primarySubject(target.c).toLowerCase();
      const idx = fresh.findIndex(c => primarySubject(c).toLowerCase() === key);
      if (idx === -1) {
        setNote({ ok: false, text: `"${target.label}" no longer exists. Pick another.` });
        setCampaigns(fresh);
        return;
      }
      const { status, campaign } = addTargetCompany(fresh[idx], name);
      if (status === 'already') {
        setNote({ ok: true, text: `Already on "${target.label}".` });
        setCampaigns(fresh);
        return;
      }
      if (status !== 'added') return;
      const next = fresh.map((c, i) => (i === idx ? campaign : c));
      await setDoc(ref, { campaigns: next, updatedAt: new Date().toISOString() });
      setCampaigns(next);
      setPick('');
      setNote({ ok: true, text: `Added to "${target.label}". Nobody was added yet: the campaign now shows that someone from ${name} should be.` });
      try { window.dispatchEvent(new CustomEvent(EMAIL_CAMPAIGNS_UPDATED_EVENT)); } catch { /* no window */ }
    } catch (err) {
      setNote({ ok: false, text: `Couldn't add to the campaign: ${err?.message || 'unknown error'}` });
    } finally {
      setBusy(false);
    }
  };

  const disabledWhy = !uid ? 'Sign in to use campaigns'
    : !name ? 'Give the company a name first'
    : campaigns === null ? 'Loading campaigns'
    : campaigns.length === 0 ? 'No saved campaigns yet. Create one on Draft Emails > Email Campaigns'
    : '';

  return (
    <div
      data-company-campaigns
      style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', padding: '0.3rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '8px', background: '#fff', maxWidth: '100%' }}
    >
      <span
        title="Put this company on a campaign without adding any of its contacts. The campaign shows that someone from here should be added."
        style={{ fontSize: '0.65rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}
      >Email Campaign</span>
      {onCampaigns.map(e => (
        <span
          key={e.index}
          title={e.filled
            ? `On the "${e.label}" campaign, and someone from here is on it`
            : `On the "${e.label}" campaign: nobody from here has been added yet`}
          style={{
            fontSize: '0.7rem', fontWeight: 600, borderRadius: 999, padding: '1px 8px', maxWidth: 220,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: e.filled ? '#065F46' : '#92400E',
            background: e.filled ? '#ECFDF5' : '#FFFBEB',
            border: `1px solid ${e.filled ? '#A7F3D0' : '#FCD34D'}`,
          }}
        >{e.filled ? '✓ ' : ''}{e.label}{e.filled ? '' : ': add someone'}</span>
      ))}
      <CampaignPicker
        options={pickerOptions}
        value={pick}
        onChange={(key) => { setPick(key); setNote(null); }}
        disabled={!!disabledWhy || busy || offCampaigns.length === 0}
        title={disabledWhy || (offCampaigns.length === 0 ? 'Already on every saved campaign' : 'Type to search, or pick from the most recent campaigns')}
        ariaLabel="Campaign to add this company to"
        placeholder={campaigns === null ? 'Loading...' : offCampaigns.length === 0 && campaigns.length > 0 ? 'On every campaign' : 'Add company to a campaign...'}
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
