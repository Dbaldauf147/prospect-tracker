// Wraps the Draft Emails composer and the Email Campaigns viewer
// behind a single sidebar entry with two sub-tabs. Folds Email
// Campaigns under Draft Emails so the sidebar isn't carrying two
// adjacent buttons that conceptually belong to the same workflow.

import { useState } from 'react';
import { DraftEmailView } from './DraftEmailView';
import { EmailCampaignView } from '../EmailCampaignView/EmailCampaignView';

export function DraftEmailsPage({ prospects, settings, updateSettings, initialTab = 'drafts' }) {
  const [tab, setTab] = useState(initialTab === 'campaigns' ? 'campaigns' : 'drafts');
  const tabBtn = (key, label) => (
    <button
      key={key}
      type="button"
      onClick={() => setTab(key)}
      style={{
        background: 'none',
        border: 'none',
        padding: '0.55rem 0.9rem',
        fontFamily: 'inherit',
        fontSize: '0.82rem',
        fontWeight: tab === key ? 700 : 500,
        color: tab === key ? '#1D4ED8' : '#475569',
        borderBottom: tab === key ? '2px solid #1D4ED8' : '2px solid transparent',
        cursor: 'pointer',
        marginBottom: -1,
      }}
    >{label}</button>
  );
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderBottom: '1px solid #E2E8F0', marginBottom: '0.75rem' }}>
        {tabBtn('drafts', 'Drafts')}
        {tabBtn('campaigns', 'Email Campaigns')}
      </div>
      {tab === 'drafts' ? (
        <DraftEmailView prospects={prospects} settings={settings} updateSettings={updateSettings} />
      ) : (
        <EmailCampaignView />
      )}
    </div>
  );
}
