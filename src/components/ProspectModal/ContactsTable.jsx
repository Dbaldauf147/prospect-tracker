import { useMemo } from 'react';
import { DataTable } from '../common/DataTable';
import { sentimentFor, sentimentMark } from '../../utils/contactSentiment';
import { BUCKETS, contactHasTag, getContactTags } from './contactTags.js';

// The company card's contact roster.
//
// It used to be a hand-rolled <table> inside the modal: seventeen columns,
// every one of them always on, at whatever width the browser worked out.
// Which is fine on a contact with a short title and hopeless on a roster
// where half the columns are empty and the one you came for (the mobile
// number, the LinkedIn search) is off the right edge behind a horizontal
// scroll.
//
// So it is the same DataTable every other grid in the app uses, and it
// arrives with what that brings: a Columns menu to switch a column off,
// a drag handle on every header, a star to say which columns are YOUR
// default view, click-to-sort, per-column filters, and the layout
// remembered per user in settings.tablePrefs.
//
// Two things it asks the shared table for that no other caller does:
//
//   gridLines  seventeen columns read across, not down. Row lines alone
//              leave a phone number floating between two headings.
//   showExport the section header above already carries an Export Excel
//              of its own - a branded workbook, not the table's generic
//              one - so the toolbar leaves that button out rather than
//              offering a second, different file three inches away.
//
// Everything the old table did behaviourally is kept: click a row to open
// the contact, the yellow tint and left bar on a decision maker, the faded
// row for a contact excluded from this company, the bulk-select checkbox
// column, and contacts tagged "left" pinned to the bottom whatever the
// sort.
const TABLE_ID = 'company-contacts';

// Tagged as having left the company. Pinned under everyone still there,
// through any sort - which is a rowGroup rather than a comparator for
// exactly that reason: a sort comparator is replaced by the next header
// click, and this outlives it.
const leftLast = (c) => (contactHasTag(c, 'left') ? 1 : 0);

const MUTED = { color: '#CBD5E1' };
const dash = <span style={MUTED}>-</span>;

const linkStyle = { color: '#0A66C2', fontSize: '0.7rem', fontWeight: 600, textDecoration: 'none' };
const searchLinkStyle = { ...linkStyle, fontSize: '0.65rem' };

// Where the contact came from, as the chip the row has always shown.
function sourceChip(source) {
  const look = source === 'manual'
    ? { bg: '#EDE9FE', color: '#5B21B6', label: 'Manual' }
    : source === 'bulk'
      ? { bg: '#DBEAFE', color: '#1D4ED8', label: 'Bulk' }
      : { bg: '#FFEDD5', color: '#9A3412', label: 'HubSpot' };
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: '999px',
      fontSize: '0.6rem', fontWeight: 700, background: look.bg, color: look.color, letterSpacing: '0.02em',
    }}>{look.label}</span>
  );
}

const fullNameOf = (c) => `${c.firstname || ''} ${c.lastname || ''}`.trim();
const notesOf = (c, settings) => (settings?.contactNotes || {})[c.id || c.vid] || c.notes || c.hs_content_membership_notes || c.message || '';
const linkedinOf = (c) => c.hs_linkedin_url || c.linkedin_url || c.hs_linkedinid || '';
const cellPhoneOf = (c) => c.mobilephone || c.mobile_phone || '';
const bucketsOf = (c) => BUCKETS.filter(b => getContactTags(c).includes(b.tag));

export function ContactsTable({
  contacts,
  company,
  settings,
  updateSettings,
  bulkSelected,
  setBulkSelected,
  excludedContactIds,
  onExclude,
  onUnexclude,
  onEditContact,
  onDeleteContact,
  deletingContact,
  emailCountsFor,
  sourceOf,
}) {
  const columns = useMemo(() => [
    {
      key: '__select__',
      label: '',
      defaultWidth: 34,
      exportValue: () => '',
      render: (c) => {
        const cid = String(c.id || c.vid || '');
        if (!cid) return null;
        return (
          <input
            type="checkbox"
            checked={bulkSelected.has(cid)}
            onClick={e => e.stopPropagation()}
            onChange={() => setBulkSelected(prev => {
              const next = new Set(prev);
              if (next.has(cid)) next.delete(cid); else next.add(cid);
              return next;
            })}
            aria-label={`Select ${fullNameOf(c) || 'this contact'}`}
            style={{ cursor: 'pointer' }}
          />
        );
      },
    },
    {
      key: 'name',
      label: 'Name',
      defaultWidth: 180,
      getSortValue: (c) => fullNameOf(c).toLowerCase(),
      getFilterValue: (c) => fullNameOf(c),
      exportValue: (c) => fullNameOf(c),
      render: (c) => {
        const name = fullNameOf(c);
        const standing = sentimentMark(sentimentFor(settings?.contactSentiment, c.id || c.vid));
        const isDM = contactHasTag(c, 'decision maker');
        return (
          <span style={{ display: 'inline-block', fontWeight: 600, color: '#1E293B' }}>
            {name || '-'}
            {standing && (
              <span
                title={`${name || 'This contact'} - ${standing.label}`}
                aria-label={standing.label}
                style={{ marginLeft: '0.3rem', fontSize: '0.8rem', fontWeight: 700, color: standing.color }}
              >{standing.symbol}</span>
            )}
            {isDM && (
              <span style={{
                marginLeft: '0.3rem', fontSize: '0.55rem', fontWeight: 700, color: '#92400E',
                background: '#FDE68A', padding: '0px 5px', borderRadius: '3px',
              }}>DM</span>
            )}
          </span>
        );
      },
    },
    {
      key: 'source',
      label: 'Source',
      defaultWidth: 90,
      title: 'Where this contact was created: HubSpot sync, bulk upload, or manual entry.',
      getFilterValue: (c) => sourceOf(c),
      exportValue: (c) => sourceOf(c),
      render: (c) => sourceChip(sourceOf(c)),
    },
    {
      key: 'fullName',
      label: 'Full Name',
      defaultWidth: 160,
      getFilterValue: (c) => fullNameOf(c),
      exportValue: (c) => fullNameOf(c),
      // The same two names as the Name column, plus the nickname somebody
      // typed on the contact popup. Kept apart from Name because Name
      // carries the marks (standing, DM) and this one is the plain string
      // you copy into an email.
      render: (c) => {
        const full = fullNameOf(c);
        const nick = (c.id && (settings?.contactNicknames || {})[c.id]) || '';
        if (!full && !nick) return dash;
        return (
          <span style={{ display: 'inline-block', color: '#1E293B' }}>
            <span>{full || '-'}</span>
            {nick && <span style={{ marginLeft: '0.35rem', fontSize: '0.65rem', color: '#64748B', fontWeight: 400 }}>({nick})</span>}
          </span>
        );
      },
    },
    {
      key: 'jobtitle',
      label: 'Title',
      defaultWidth: 190,
      render: (c) => (c.jobtitle ? <span style={{ color: '#475569' }} title={c.jobtitle}>{c.jobtitle}</span> : dash),
    },
    {
      key: 'tags',
      label: 'Tags',
      defaultWidth: 150,
      getFilterValue: (c) => (c.dans_tags || c.dan_s_tags || c.dans_tag || ''),
      exportValue: (c) => (c.dans_tags || c.dan_s_tags || c.dans_tag || ''),
      render: (c) => {
        const raw = c.dans_tags || c.dan_s_tags || c.dans_tag || '';
        return raw ? <span style={{ fontSize: '0.68rem', color: '#475569' }} title={raw}>{raw}</span> : dash;
      },
    },
    {
      key: 'category',
      label: 'Category',
      defaultWidth: 170,
      // Filtered and exported as the bucket names, which is what the chips
      // say: a filter matching "procurement" should find the row whose
      // chip reads Procurement.
      getFilterValue: (c) => bucketsOf(c).map(b => b.label).join(', '),
      exportValue: (c) => bucketsOf(c).map(b => b.label).join(', '),
      render: (c) => {
        const matched = bucketsOf(c);
        if (matched.length === 0) return <span style={{ fontSize: '0.62rem', ...MUTED }}>-</span>;
        return (
          <span style={{ display: 'flex', flexWrap: 'nowrap', gap: '2px', overflow: 'hidden' }}>
            {matched.map(b => (
              <span key={b.key} style={{
                padding: '1px 6px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 700,
                background: b.headerBg, color: b.headerColor, whiteSpace: 'nowrap',
              }}>{b.label}</span>
            ))}
          </span>
        );
      },
    },
    {
      key: 'email',
      label: 'Email',
      defaultWidth: 200,
      render: (c) => (c.email ? <span style={{ color: '#475569' }} title={c.email}>{c.email}</span> : dash),
    },
    {
      key: 'sent',
      label: 'Sent',
      defaultWidth: 62,
      title: 'Outbound emails to this contact, sourced from the Activity tab.',
      getSortValue: (c) => emailCountsFor(c).sent,
      getFilterValue: (c) => String(emailCountsFor(c).sent || ''),
      exportValue: (c) => emailCountsFor(c).sent || '',
      render: (c) => {
        const n = emailCountsFor(c).sent;
        return (
          <span
            style={{ display: 'block', textAlign: 'right', color: n > 0 ? '#1E293B' : '#CBD5E1', fontVariantNumeric: 'tabular-nums' }}
            title={n > 0 ? `${n} outbound emails to this contact (Activity tab)` : 'No outbound emails recorded'}
          >{n || '-'}</span>
        );
      },
    },
    {
      key: 'received',
      label: 'Received',
      defaultWidth: 78,
      title: 'Inbound emails from this contact, sourced from the Activity tab.',
      getSortValue: (c) => emailCountsFor(c).received,
      getFilterValue: (c) => String(emailCountsFor(c).received || ''),
      exportValue: (c) => emailCountsFor(c).received || '',
      render: (c) => {
        const n = emailCountsFor(c).received;
        return (
          <span
            style={{ display: 'block', textAlign: 'right', color: n > 0 ? '#1E293B' : '#CBD5E1', fontVariantNumeric: 'tabular-nums' }}
            title={n > 0 ? `${n} inbound emails from this contact (Activity tab)` : 'No inbound emails recorded'}
          >{n || '-'}</span>
        );
      },
    },
    {
      key: 'phone',
      label: 'Work Phone',
      defaultWidth: 130,
      render: (c) => (c.phone ? <span style={{ color: '#475569' }}>{c.phone}</span> : dash),
    },
    {
      key: 'cellPhone',
      label: 'Cell Phone',
      defaultWidth: 130,
      getFilterValue: cellPhoneOf,
      exportValue: cellPhoneOf,
      render: (c) => {
        const v = cellPhoneOf(c);
        return v ? <span style={{ color: '#475569' }}>{v}</span> : dash;
      },
    },
    {
      key: 'city',
      label: 'City',
      defaultWidth: 120,
      render: (c) => (c.city ? <span style={{ color: '#475569' }} title={c.city}>{c.city}</span> : dash),
    },
    {
      key: 'country',
      label: 'Country',
      defaultWidth: 110,
      render: (c) => (c.country ? <span style={{ color: '#475569' }} title={c.country}>{c.country}</span> : dash),
    },
    {
      key: 'linkedin',
      label: 'LinkedIn',
      defaultWidth: 90,
      getFilterValue: linkedinOf,
      exportValue: linkedinOf,
      render: (c) => {
        const url = linkedinOf(c);
        if (!url) return dash;
        return (
          <a
            href={url.startsWith('http') ? url : `https://linkedin.com/in/${url}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={linkStyle}
            title={url}
          >View</a>
        );
      },
    },
    {
      key: 'linkedinSearch',
      label: 'LinkedIn Search',
      defaultWidth: 120,
      title: "Open LinkedIn / Sales Navigator pre-filtered to this contact's name + company.",
      // Nothing of the contact's own: two searches built from the name and
      // the company. Nothing to sort, filter or export.
      getFilterValue: () => '',
      exportValue: () => '',
      render: (c) => {
        const parts = [c.firstname, c.lastname, c.company || company].map(s => String(s || '').trim()).filter(Boolean);
        if (parts.length === 0) return dash;
        const keywords = encodeURIComponent(parts.join(' '));
        return (
          // `display: flex` inline, not in a class: the table's own cell
          // rule sets every direct child to inline-block, which would put
          // these two links side by side and clip the second.
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.25 }}>
            <a
              href={`https://www.linkedin.com/search/results/people/?keywords=${keywords}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title={`Open regular LinkedIn people search for "${parts.join(' ')}": best for grabbing the canonical linkedin.com/in/ URL.`}
              style={searchLinkStyle}
            >LinkedIn ↗</a>
            <a
              href={`https://www.linkedin.com/sales/search/people?keywords=${keywords}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title={`Open Sales Navigator search pre-filtered to "${parts.join(' ')}".`}
              style={searchLinkStyle}
            >Sales Nav ↗</a>
          </span>
        );
      },
    },
    {
      key: 'notes',
      label: 'Notes',
      defaultWidth: 200,
      getFilterValue: (c) => notesOf(c, settings),
      exportValue: (c) => notesOf(c, settings),
      render: (c) => {
        const note = notesOf(c, settings);
        return note
          ? <span style={{ fontSize: '0.68rem', color: '#475569' }} title={note}>{note}</span>
          : dash;
      },
    },
    {
      // Named rather than blank: the header is the only place the Columns
      // menu can read a name off, and two locked "(unnamed)" rows in that
      // list tell nobody anything.
      key: 'actions',
      label: 'Actions',
      defaultWidth: 78,
      getFilterValue: () => '',
      exportValue: () => '',
      render: (c) => {
        const cid = String(c.id || c.vid || '');
        const isExcluded = excludedContactIds.has(cid);
        return (
          <span style={{ display: 'inline-block', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
            {cid && (isExcluded ? (
              <button
                onClick={e => { e.stopPropagation(); onUnexclude(cid); }}
                title="Re-add this contact to this company"
                style={{ background: 'none', border: 'none', color: '#059669', fontSize: '0.66rem', fontWeight: 700, cursor: 'pointer', padding: '0 4px', lineHeight: 1, fontFamily: 'inherit' }}
              >＋ Re-add</button>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); onExclude(cid); }}
                title="Remove from this company only (keeps the contact in HubSpot)"
                style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.9rem', cursor: 'pointer', padding: '0 3px', lineHeight: 1, fontFamily: 'inherit' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#F59E0B'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#CBD5E1'; }}
              >⊘</button>
            ))}
            <button
              onClick={e => { e.stopPropagation(); onDeleteContact(c); }}
              disabled={deletingContact === (c.id || c.vid)}
              title="Delete contact from HubSpot (permanent)"
              style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.85rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1, fontFamily: 'inherit' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#EF4444'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#CBD5E1'; }}
            >{deletingContact === (c.id || c.vid) ? '...' : '×'}</button>
          </span>
        );
      },
    },
  ], [settings, bulkSelected, setBulkSelected, excludedContactIds, onExclude, onUnexclude,
    onDeleteContact, deletingContact, emailCountsFor, sourceOf, company]);

  // The row's own tints, which say two things at a glance and have to
  // survive every sort: a decision maker is the row you came for, and a
  // contact excluded from this company is still listed but no longer part
  // of it.
  const rowStyle = (c) => {
    const isDM = contactHasTag(c, 'decision maker');
    const isExcluded = excludedContactIds.has(String(c.id || c.vid || ''));
    const style = {};
    if (isDM) { style.background = '#FEFCE8'; style.boxShadow = 'inset 3px 0 0 #F59E0B'; }
    if (isExcluded) style.opacity = 0.5;
    return Object.keys(style).length > 0 ? style : undefined;
  };

  return (
    // Capped and scrolled, the way the hand-rolled table was: the modal
    // holds several sections and a roster of two hundred people must not
    // push the ones under it off the page.
    <div style={{ height: 440, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'hidden' }}>
      <DataTable
        tableId={TABLE_ID}
        columns={columns}
        rows={contacts}
        alwaysVisible={['__select__', 'name', 'actions']}
        rowGroup={leftLast}
        rowStyle={rowStyle}
        onRowClick={onEditContact}
        gridLines
        showExport={false}
        enableColumnFilters
        // The LinkedIn Search cell stacks two links, so a row is taller
        // than one line and the fixed-height virtualization math would be
        // measuring the wrong thing. A company's roster is tens of rows,
        // not thousands, so rendering them all costs nothing.
        variableRowHeight
        settings={settings}
        updateSettings={updateSettings}
        emptyMessage="No contacts for this company yet."
      />
    </div>
  );
}

export default ContactsTable;
