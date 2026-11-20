// The Failed Emails sub-tab of Email Campaigns: every campaign contact whose
// email didn't arrive, from the forwarded bounce notices (settings.badEmails)
// and the bounces the campaigns caught themselves. Rows are built in
// utils/failedCampaignEmails.js; this is the table, on the shared DataTable
// so it carries Dan's column formatting.
import { useMemo } from 'react';
import { DataTable } from '../common/DataTable';
import { BounceForwardNote } from './BounceForwardNote';
import { FAILED_STATE, FAILED_SOURCE } from '../../utils/failedCampaignEmails';

const TABLE_ID = 'email-campaign-failed-emails';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
const ms = (iso) => { const v = Date.parse(iso || ''); return Number.isFinite(v) ? v : null; };

const linkBtn = {
  background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', fontSize: '0.78rem',
  color: 'var(--color-accent)', cursor: 'pointer', textAlign: 'left', maxWidth: '100%',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const SOURCE_TITLE = {
  [FAILED_SOURCE.NOTICE]: 'You forwarded the delivery-failure notice for this address to the app mailbox.',
  [FAILED_SOURCE.CAMPAIGN]: "The campaign's own lookup caught a bounce on this send.",
  [FAILED_SOURCE.BOTH]: 'A forwarded notice and the campaign both caught this bounce.',
};

// A failed address whose contact is tagged "hide": the row is greyed and
// its address struck through, with a Hidden pill, so it reads as already
// put aside rather than one still to fix.
const HIDDEN_ROW_STYLE = { background: '#F1F5F9', color: '#94A3B8', fontStyle: 'italic' };
const hiddenPill = {
  flexShrink: 0, padding: '0 6px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, fontStyle: 'normal',
  background: '#EDE9FE', border: '1px solid #C4B5FD', color: '#5B21B6',
};
const HIDDEN_TITLE = 'This contact is tagged "hide", so it is hidden from the contact lists.';

export function FailedEmailsPanel({ rows, hiddenEmails, companyFor, onOpenContact, onOpenCampaign, settings, updateSettings }) {
  const columns = useMemo(() => [
    {
      key: 'email', label: 'Email', defaultWidth: 240,
      render: (r) => {
        const hidden = hiddenEmails?.has(r.email);
        const btn = (
          <button
            type="button"
            style={hidden ? { ...linkBtn, color: '#94A3B8', textDecoration: 'line-through' } : linkBtn}
            title={hidden ? `${HIDDEN_TITLE} Click to open the contact.` : 'Open the contact to fix the address'}
            onClick={(e) => { e.stopPropagation(); onOpenContact?.(r.email, r.company); }}
          >{r.email}</button>
        );
        if (!hidden) return btn;
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {btn}
            <span style={hiddenPill} title={HIDDEN_TITLE}>Hidden</span>
          </span>
        );
      },
    },
    {
      key: 'hidden', label: 'Hidden', defaultWidth: 80,
      getFilterValue: (r) => (hiddenEmails?.has(r.email) ? 'Hidden' : 'Shown'),
      getSortValue: (r) => (hiddenEmails?.has(r.email) ? 1 : 0),
      render: (r) => (hiddenEmails?.has(r.email) ? <span title={HIDDEN_TITLE}>Hidden</span> : ''),
    },
    { key: 'name', label: 'Name', defaultWidth: 150 },
    {
      key: 'company', label: 'Company', defaultWidth: 170,
      getFilterValue: (r) => r.company || companyFor?.({ email: r.email })?.name || '',
      getSortValue: (r) => (r.company || companyFor?.({ email: r.email })?.name || '').toLowerCase() || null,
      render: (r) => {
        if (r.company) return r.company;
        const guess = companyFor?.({ email: r.email });
        return guess?.name ? <span style={{ color: 'var(--color-text-muted)' }} title="Read off the email domain">{guess.name}</span> : '';
      },
    },
    {
      key: 'campaign', label: 'Campaign', defaultWidth: 220,
      render: (r) => (
        <button type="button" style={linkBtn} title="Open this campaign" onClick={(e) => { e.stopPropagation(); onOpenCampaign?.(r.campaignIndex); }}>{r.campaign}</button>
      ),
    },
    { key: 'sentDate', label: 'Sent Date', defaultWidth: 110, getSortValue: (r) => ms(r.sentDate), getFilterValue: (r) => fmtDate(r.sentDate), render: (r) => fmtDate(r.sentDate) },
    { key: 'failedAt', label: 'Failed On', defaultWidth: 110, getSortValue: (r) => ms(r.failedAt), getFilterValue: (r) => fmtDate(r.failedAt), render: (r) => fmtDate(r.failedAt) },
    {
      key: 'state', label: 'Status', defaultWidth: 115,
      render: (r) => {
        const isBad = r.state === FAILED_STATE.BAD;
        return (
          <span
            style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, background: isBad ? '#FEE2E2' : '#DCFCE7', border: `1px solid ${isBad ? '#FCA5A5' : '#86EFAC'}`, color: isBad ? '#B91C1C' : '#166534' }}
            title={isBad ? 'Still flagged. Fix the address on the contact popup, or Mark fixed there.' : 'Marked fixed on the contact popup since this bounce.'}
          >{r.state}</span>
        );
      },
    },
    { key: 'source', label: 'Source', defaultWidth: 140, render: (r) => <span title={SOURCE_TITLE[r.source] || ''}>{r.source}</span> },
    { key: 'reason', label: 'Reason', defaultWidth: 260, render: (r) => <span title={r.reason}>{r.reason}</span> },
    { key: 'noticeSubject', label: 'Notice Subject', defaultWidth: 220, render: (r) => <span title={r.noticeSubject}>{r.noticeSubject}</span> },
    { key: 'replied', label: 'Replied', defaultWidth: 80, getFilterValue: (r) => (r.replied ? 'Yes' : ''), getSortValue: (r) => (r.replied ? 1 : 0), render: (r) => (r.replied ? 'Yes' : '') },
  ], [companyFor, onOpenContact, onOpenCampaign, hiddenEmails]);

  const stillBad = rows.filter(r => r.state === FAILED_STATE.BAD).length;
  const hiddenCount = hiddenEmails ? rows.filter(r => hiddenEmails.has(r.email)).length : 0;
  return (
    <div data-failed-emails>
      <BounceForwardNote />
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
        {rows.length
          ? `${rows.length} failed send${rows.length === 1 ? '' : 's'} across your campaigns, ${stillBad} still flagged as a bad email${hiddenCount ? `, ${hiddenCount} on contacts tagged hide (greyed out)` : ''}. Click an address to fix it on the contact, or a campaign to open it.`
          : 'No failed emails on any campaign. Forward a delivery-failure notice to the address above and it shows up here.'}
      </div>
      {/* DataTable fills its parent's height, so give it a box: sized to
          the rows, capped so a long list scrolls inside it. */}
      <div style={{ height: `min(70vh, ${140 + Math.max(rows.length, 1) * 40}px)`, display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--color-surface)' }}>
      <DataTable
        tableId={TABLE_ID}
        exportFileName="Failed campaign emails"
        columns={columns}
        rows={rows}
        alwaysVisible={['email']}
        defaultHidden={['noticeSubject', 'replied', 'hidden']}
        rowStyle={(r) => (hiddenEmails?.has(r.email) ? HIDDEN_ROW_STYLE : undefined)}
        emptyMessage="No failed emails"
        settings={settings}
        updateSettings={updateSettings}
      />
      </div>
    </div>
  );
}
