// The "Sent To" tick boxes for one saved campaign: Clients, Key Contacts,
// Prospects (utils/campaignAudience). Used by Email Campaigns > Saved
// Campaigns and the Prospecting ladder's market-updates table.
// With `onSchedule`, each audience not yet ticked also gets its planned send
// date (AudienceScheduleDate).
import { CAMPAIGN_AUDIENCES, campaignAudience, campaignSchedule } from '../../utils/campaignAudience';
import { AudienceScheduleDate } from './AudienceScheduleDate';

export function CampaignAudienceTicks({ campaign, onToggle, onSchedule, disabled = false }) {
  const on = campaignAudience(campaign);
  const dates = campaignSchedule(campaign);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {CAMPAIGN_AUDIENCES.map(a => (
        <span key={a.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: on[a.key] ? '#166534' : 'var(--color-text-secondary, #475569)', fontWeight: on[a.key] ? 700 : 500, cursor: disabled ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            checked={on[a.key]}
            disabled={disabled}
            onChange={e => onToggle?.(a.key, e.target.checked)}
            aria-label={`Sent to ${a.label}`}
            style={{ margin: 0, accentColor: '#16A34A', cursor: disabled ? 'default' : 'pointer' }}
          />
          {a.label}
        </label>
        {onSchedule && !on[a.key] && (
          <AudienceScheduleDate value={dates[a.key]} label={a.label} disabled={disabled} onChange={day => onSchedule(a.key, day)} />
        )}
        </span>
      ))}
    </div>
  );
}
