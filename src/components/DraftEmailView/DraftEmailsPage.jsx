// Wraps the Draft Emails composer, the Email Campaigns viewer and the
// Email Tracking dashboard behind a single sidebar entry with sub-tabs.
// The three belong to one workflow — compose a batch, watch the campaign
// it belongs to, read the opens and clicks it produced — so the sidebar
// isn't carrying separate buttons for each step.
//
// Tracking and Campaigns are linked: clicking a campaign in the tracking
// table hops to the Email Campaigns tab with that campaign open.

import { useState } from 'react';
import { DraftEmailView } from './DraftEmailView';
import { EmailCampaignView } from '../EmailCampaignView/EmailCampaignView';
import { EmailTrackingView } from '../EmailTrackingView/EmailTrackingView';
import { SiteListOverview } from './SiteListOverview';
import { DansDraftsView } from './DansDraftsView';
import { MarketUpdatesView } from './MarketUpdatesView';

const TABS = ['drafts', 'dansdrafts', 'marketupdates', 'campaigns', 'tracking', 'sitelists'];

export function DraftEmailsPage({ prospects, settings, updateSettings, updateSettingsPath, cdmName = '', initialTab = 'drafts' }) {
  const [tab, setTab] = useState(TABS.includes(initialTab) ? initialTab : 'drafts');
  // Subject of a campaign the tracking tab asked to open. Cleared as soon as
  // the campaign view picks it up, so clicking the same campaign twice works.
  const [openCampaignSubject, setOpenCampaignSubject] = useState(null);

  const openCampaign = (campaign) => {
    if (campaign?.subject) setOpenCampaignSubject(campaign.subject);
    setTab('campaigns');
  };

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
        {tabBtn('dansdrafts', "Dan's Drafts")}
        {tabBtn('marketupdates', 'Market Updates')}
        {tabBtn('campaigns', 'Email Campaigns')}
        {tabBtn('tracking', 'Email Tracking')}
        {tabBtn('sitelists', 'Site List Overview')}
      </div>
      {tab === 'drafts' && (
        <DraftEmailView prospects={prospects} settings={settings} updateSettings={updateSettings} updateSettingsPath={updateSettingsPath} cdmName={cdmName} />
      )}
      {tab === 'dansdrafts' && (
        <DansDraftsView settings={settings} updateSettings={updateSettings} />
      )}
      {tab === 'marketupdates' && <MarketUpdatesView />}
      {tab === 'campaigns' && (
        <EmailCampaignView
          openSubject={openCampaignSubject}
          onOpened={() => setOpenCampaignSubject(null)}
        />
      )}
      {tab === 'tracking' && <EmailTrackingView onOpenCampaign={openCampaign} />}
      {tab === 'sitelists' && (
        <SiteListOverview prospects={prospects} settings={settings} />
      )}
    </div>
  );
}
