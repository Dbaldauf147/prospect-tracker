// The company card's Email Domains field: the ordered list of
// "<pattern>@<domain>" entries every guessed address on the account is
// built from (utils/emailDomainPattern.js). The order is the tier order:
// buildEmailFromPattern walks the field and takes the first entry that can
// build an address, so the 1st tier is used first, the 2nd when the 1st
// can't, and so on.
//
// With nothing recorded the field defaults to the estimate from the
// contacts on the card, every format they support with the one most of
// them are written in first. It is shown, not saved: opening a company
// never quietly rewrites it. "Save these" records it; "Edit tiers..."
// opens the picker to tick, untick and reorder.
//
// Moved out of ProspectModal so it can be rendered on its own; the card
// passes the field's value, its setter, and the estimate.
//
// When the contacts are spread over more than one work domain, the tiers
// follow the domains instead: one per domain, the domain with the most
// contacts first (domainTierEntries). With nothing recorded that is the
// estimate shown; with something recorded, "Tier by contacts" rebuilds the
// field that way, keeping each domain's recorded format.
import { useState } from 'react';
import { PopupListField } from './PopupListField';
import { domainTierEntries } from '../../utils/emailDomainPattern';

export function EmailDomainsField({ value, onChange, options }) {
  // The picker. `domainPicks` is the field as it would be saved: an ordered
  // list of entries, 1st tier first. Held here so the panel survives a
  // re-render (a contact sync landing mid-read) rather than closing under
  // the user.
  const [domainPickerOpen, setDomainPickerOpen] = useState(false);
  const [domainPicks, setDomainPicks] = useState([]);
  // What is typed in the "+ Add domain" box. It used to be committed on
  // Enter only, so typing a domain and clicking Done (or anywhere else)
  // threw it away without a word. Now Enter, the Add button and leaving
  // the box all record it.
  const [draft, setDraft] = useState('');

  const domains = (value || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
  const opts = options;
  const lower = v => String(v || '').toLowerCase();
  const recorded = new Set(domains.map(lower));
  const newCandidates = opts.candidates.filter(o => !recorded.has(lower(o.entry)));
  // "address" takes -es, and every other word here takes -s.
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : /s$/.test(word) ? 'es' : 's'}`;
  // The field is ordered and read in order (buildEmailFromPattern
  // takes the first entry it can build an address from), so each
  // entry is a tier: 1st, then 2nd when the 1st can't build one.
  const tier = (i) => {
    const n = i + 1;
    const t = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    return `${n}${t}`.toUpperCase();
  };
  const addDraft = () => {
    const typed = draft.split(/[\n;,\s]+/).map(t => t.trim()).filter(Boolean);
    if (!typed.length) return;
    const have = new Set(domains.map(lower));
    const fresh = [];
    for (const t of typed) {
      if (have.has(lower(t))) continue;
      have.add(lower(t));
      fresh.push(t);
    }
    if (fresh.length) onChange([...domains, ...fresh].join('\n'));
    setDraft('');
  };
  const move = (list, i, by) => {
    const j = i + by;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };
  // With nothing recorded, the field defaults to the contacts'
  // estimate: every format they support, the one most of them
  // are written in first. Shown, not saved - opening a company
  // never quietly rewrites it - until Save these is clicked.
  // Contacts on two or more work domains: tier by domain, busiest first.
  const multiDomain = (opts.domains || []).length >= 2;
  const domainTiers = multiDomain ? domainTierEntries(opts, domains) : [];
  const countByDomain = new Map((opts.domains || []).map(d => [d.domain, d.count]));
  const domainOfEntry = (e) => { const s = lower(e).trim(); const at = s.lastIndexOf('@'); return at >= 0 ? s.slice(at + 1) : s; };
  const tieredDiffers = multiDomain && domains.length > 0
    && domainTiers.map(o => lower(o.entry)).join('\n') !== domains.map(lower).join('\n');
  const estimated = domains.length === 0 ? (multiDomain ? domainTiers : opts.candidates) : [];
  const tierBadge = { fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.03em' };
  const arrowBtn = { background: 'none', border: 'none', fontSize: '0.62rem', cursor: 'pointer', padding: '0 1px', lineHeight: 1 };

  // Everything the picker can list, in the order it would be
  // saved in: the formats the contacts support, then whatever
  // is already in the field that no contact votes for (typed
  // by hand, or learned back when the roster looked
  // different). One list, because the field is ordered and
  // the primary can be any of them - including one that was
  // already there.
  const rows = [
    ...opts.candidates.map(o => ({ ...o, suggested: true, onRecord: recorded.has(lower(o.entry)) })),
    ...domains
      .filter(d => !opts.candidates.some(o => lower(o.entry) === lower(d)))
      .map(d => ({ entry: d, suggested: false, onRecord: true, samples: [], votes: 0 })),
  ];
  // Domains that taught nothing at all. Named rather than
  // dropped: "nothing offered for parentco.com" answers the
  // question, and silence about it reads as a bug.
  const quiet = opts.domains.filter(d => !opts.candidates.some(o => o.domain === d.domain));

  // Why the button can't do anything, said on the button
  // itself. A disabled control with no reason is a control
  // that reads as broken.
  const busiest = opts.domains[0];
  const estimateBlocked = rows.length > 0
    ? ''
    : opts.reason === 'no-contacts'
      ? 'No contacts on this company yet, so there is nothing to learn a format from. Add them on the Contacts tab.'
      : opts.reason === 'no-work-emails'
        ? 'The contacts here have no work addresses - free-mail or blank only - and those say nothing about how this company builds an address.'
        : opts.reason === 'no-pattern' && busiest
          ? `The ${plural(busiest.count, 'address')} at ${busiest.domain} do not follow one convention, so there is nothing worth recording.`
          : 'There is nothing to estimate from yet.';

  const openPicker = () => {
    // Opens on what is already recorded, in the order it is
    // recorded in, with the best NEW suggestion ticked on the
    // end. Open it and hit Save without touching anything and
    // you get exactly what the old one-shot button gave you.
    // With nothing recorded it opens on the estimate, every
    // format ticked in majority order, as the field shows it.
    const start = domains.length === 0 ? estimated.map(o => o.entry) : [...domains];
    if (domains.length > 0 && newCandidates[0]) start.push(newCandidates[0].entry);
    setDomainPicks(start);
    setDomainPickerOpen(true);
  };
  const togglePick = entry => setDomainPicks(prev => (
    prev.some(e => lower(e) === lower(entry))
      ? prev.filter(e => lower(e) !== lower(entry))
      : [...prev, entry]
  ));
  const makePrimary = entry => setDomainPicks(prev => (
    [entry, ...prev.filter(e => lower(e) !== lower(entry))]
  ));
  const movePick = (entry, by) => setDomainPicks(prev => move(prev, prev.findIndex(e => lower(e) === lower(entry)), by));

  // The card shows one compact line; the chips, the estimate buttons and
  // the tier picker all live in the popup it opens.
  const summaryItems = domains.length > 0 ? domains : estimated.map(o => o.entry);
  const summaryTone = domains.length > 0 ? 'default' : estimated.length > 0 ? 'estimated' : 'missing';
  // Recorded, but the contacts use domains the tiers don't follow: say so on
  // the closed field, since the fix ("Tier by contacts") is inside it.
  const summaryBadge = summaryTone === 'default' ? (tieredDiffers ? (
    <span
      data-domains-badge
      title={`Contacts here use ${opts.domains.length} email domains: ${opts.domains.map(d => `${d.domain} (${plural(d.count, 'contact')})`).join(', ')}. Open to tier them by contact count.`}
      style={{ flexShrink: 0, padding: '0 0.45rem', borderRadius: 999, fontSize: '0.66rem', fontWeight: 700, background: '#EFF6FF', border: '1px solid #93C5FD', color: '#1D4ED8' }}
    >{opts.domains.length} domains</span>
  ) : null) : (
    <span style={{ flexShrink: 0, padding: '0 0.45rem', borderRadius: 999, fontSize: '0.66rem', fontWeight: 700, ...(summaryTone === 'missing'
      ? { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C' }
      : { background: '#FFFBEB', border: '1px solid #FCD34D', color: '#B45309' }) }}
    >{summaryTone === 'missing' ? 'Missing' : 'Estimated'}</span>
  );

  return (
    <PopupListField
      title="Email Domains"
      items={summaryItems}
      placeholder="No email format on record"
      badge={summaryBadge}
      tone={summaryTone}
    >
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', padding: '0.1rem 0.35rem', border: `1px solid ${domains.length > 0 ? 'var(--color-border)' : estimated.length > 0 ? '#FCD34D' : '#FCA5A5'}`, borderRadius: 'var(--radius-md)', minHeight: '28px', alignItems: 'center' }}>
        {/* Nothing on record is worth saying out loud: this
            field is what every guessed address on the account
            is built from, and an empty box reads exactly like
            a field nobody needed. */}
        {domains.length === 0 && estimated.length === 0 && (
          <span
            title="No email format on record. Without one, nothing can guess an address for a contact here: name-only pastes on Bulk Add Contacts stay blank."
            style={{ display: 'inline-flex', alignItems: 'center', padding: '0.15rem 0.5rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, color: '#B91C1C' }}
          >Missing</span>
        )}
        {estimated.length > 0 && (
          <span
            title={`Nothing is recorded, so these are estimated from the ${plural(opts.total, 'contact')} here: the format most of them are written in first. Save these to record them, or Edit tiers to change the order.`}
            style={{ display: 'inline-flex', alignItems: 'center', padding: '0.15rem 0.5rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, color: '#B45309' }}
          >Estimated</span>
        )}
        {estimated.map((o, i) => (
          <span
            key={o.entry}
            title={multiDomain
              ? `${plural(o.domainCount, 'contact')} at ${o.domain}${o.votes ? `, ${o.votes} written this way` : ', no shared naming convention, so no address is built from it'}.`
              : `${o.votes} of the ${plural(o.domainCount, 'contact')} at ${o.domain} ${o.votes === 1 ? 'is' : 'are'} written this way.`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.15rem 0.5rem', background: '#fff', border: '1px dashed #93C5FD', borderRadius: '999px', fontSize: '0.72rem', color: '#1E40AF' }}
          >
            {estimated.length > 1 && <span style={{ ...tierBadge, color: '#2563EB' }}>{tier(i)}</span>}
            {o.entry}
            <span style={{ fontSize: '0.62rem', color: '#64748B' }}>({multiDomain ? o.domainCount : o.votes})</span>
          </span>
        ))}
        {domains.map((d, i) => (
          <span
            key={i}
            title={domains.length > 1 ? `${tier(i)} tier: ${i === 0 ? 'used first when an address is guessed here' : 'used when the tiers above it cannot build an address'}.` : undefined}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.5rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '999px', fontSize: '0.72rem', color: '#1E40AF' }}
          >
            {domains.length > 1 && (
              <span style={{ ...tierBadge, color: '#2563EB' }}>{tier(i)}</span>
            )}
            {d}
            {multiDomain && countByDomain.has(domainOfEntry(d)) && (
              <span title={`${plural(countByDomain.get(domainOfEntry(d)), 'contact')} at ${domainOfEntry(d)}`} style={{ fontSize: '0.62rem', color: '#64748B' }}>({countByDomain.get(domainOfEntry(d))})</span>
            )}
            {domains.length > 1 && i > 0 && (
              <button type="button" title="Move up a tier" onClick={() => onChange(move(domains, i, -1).join('\n'))} style={{ ...arrowBtn, color: '#60A5FA' }}>&#9664;</button>
            )}
            {domains.length > 1 && i < domains.length - 1 && (
              <button type="button" title="Move down a tier" onClick={() => onChange(move(domains, i, 1).join('\n'))} style={{ ...arrowBtn, color: '#60A5FA' }}>&#9654;</button>
            )}
            <button
              type="button"
              onClick={() => {
                const next = domains.filter((_, j) => j !== i);
                onChange(next.join('\n'));
              }}
              style={{ background: 'none', border: 'none', color: '#93C5FD', fontSize: '0.8rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
            >&times;</button>
          </span>
        ))}
        <input
          type="text"
          placeholder={domains.length === 0 && estimated.length === 0 ? 'firstname.lastname@domain.com' : '+ Add domain'}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addDraft();
            }
          }}
          onBlur={addDraft}
          style={{ border: 'none', outline: 'none', fontSize: '0.78rem', fontFamily: 'inherit', color: 'var(--color-text)', padding: '0.15rem 0', minWidth: '140px', flex: '1 1 140px', background: 'none' }}
        />
        {draft.trim() && (
          <button
            type="button"
            data-add-domain
            // Keep focus in the box until the click lands, so the blur
            // commit and this one don't both run.
            onMouseDown={e => e.preventDefault()}
            onClick={addDraft}
            title="Add what is typed (Enter does the same)"
            style={{ padding: '0.1rem 0.5rem', border: '1px solid #2563EB', borderRadius: 4, background: '#2563EB', color: '#fff', fontSize: '0.68rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0 }}
          >Add</button>
        )}
      </div>
      {/* The contacts on this card have already answered this
          question, one address each - but they can answer it
          more than one way, and a company that acquired
          another usually does. So the button opens the whole
          field of answers with the addresses behind each,
          rather than committing the winner unseen: the user
          picks which one is used first and keeps the rest. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        {estimated.length > 0 && (
          <button
            type="button"
            onClick={() => onChange(estimated.map(o => o.entry).join('\n'))}
            title="Record the estimated formats in this order, 1st first."
            style={{ padding: '0.2rem 0.5rem', border: '1px solid #16A34A', borderRadius: 4, background: '#16A34A', color: '#fff', fontSize: '0.68rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
          >{estimated.length === 1 ? 'Save this format' : `Save these ${estimated.length} formats`}</button>
        )}
        <button
          type="button"
          disabled={rows.length === 0}
          onClick={() => (domainPickerOpen ? setDomainPickerOpen(false) : openPicker())}
          title={estimateBlocked || (newCandidates.length > 0
            ? `${plural(newCandidates.length, 'format')} the contacts here support and this field does not have yet. Opens them with the addresses behind each, to pick from.`
            : 'Everything the contacts here suggest is already recorded. Opens the list to change which one is used first, or to remove one.')}
          style={{
            padding: '0.2rem 0.5rem',
            border: `1px solid ${rows.length === 0 ? 'var(--color-border)' : newCandidates.length > 0 ? '#86EFAC' : '#CBD5E1'}`,
            borderRadius: 4,
            background: rows.length === 0 ? '#F8FAFC' : newCandidates.length > 0 ? '#F0FDF4' : '#F8FAFC',
            color: rows.length === 0 ? '#94A3B8' : newCandidates.length > 0 ? '#166534' : '#475569',
            fontSize: '0.68rem',
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {estimated.length > 0
            ? 'Edit tiers...'
            : newCandidates.length > 0
              ? `Estimate from ${plural(opts.total, 'contact')}...`
              : 'Estimate from contacts...'}
        </button>
        {tieredDiffers && (
          <button
            type="button"
            data-tier-by-contacts
            onClick={() => onChange(domainTiers.map(o => o.entry).join('\n'))}
            title={`Rebuild the tiers one per domain, the one with the most contacts first: ${domainTiers.map((o, i) => `${tier(i)} ${o.entry} (${plural(o.domainCount, 'contact')})`).join(', ')}. A domain's recorded format is kept.`}
            style={{ padding: '0.2rem 0.5rem', border: '1px solid #93C5FD', borderRadius: 4, background: '#EFF6FF', color: '#1D4ED8', fontSize: '0.68rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
          >Tier by contacts ({opts.domains.length} domains)</button>
        )}
        {estimated.length > 0 && !domainPickerOpen && (
          <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
            {multiDomain
              ? `Contacts use ${opts.domains.length} domains: one tier each, the one with the most contacts first.`
              : `Estimated from ${plural(opts.total, 'contact')}, most-used format first.`}
          </span>
        )}
        {tieredDiffers && !domainPickerOpen && (
          <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Contacts: {(opts.domains || []).map(d => `${d.domain} ${d.count}`).join(', ')}
          </span>
        )}
        {!domainPickerOpen && estimated.length === 0 && newCandidates.length > 0 && !tieredDiffers && (
          <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {newCandidates[0].entry}
            {newCandidates.length > 1 ? ` and ${newCandidates.length - 1} other option${newCandidates.length === 2 ? '' : 's'}` : ''}
          </span>
        )}
      </div>

      {domainPickerOpen && (
        <div style={{ marginTop: 4, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 100, maxHeight: 340, overflowY: 'auto' }}>
          <div style={{ padding: '0.5rem 0.6rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#334155' }}>
              {opts.candidates.length > 0
                ? `Formats the ${plural(opts.total, 'work address')} here suggest`
                : 'Formats on record'}
            </div>
            <div style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.4 }}>
              Tick every format that is real at this company, and put them in tiers: an address is built from the 1st tier, falling back to the 2nd, then the 3rd, when a tier above can't build one. Every ticked format also pulls contacts on its domain onto this card. Formats are listed most-used first. Read the addresses before trusting a format: it is what the app will write to somebody.
            </div>
          </div>
          {rows.map(row => {
            const idx = domainPicks.findIndex(e => lower(e) === lower(row.entry));
            const picked = idx >= 0;
            const isPrimary = idx === 0;
            const hasPattern = row.entry.lastIndexOf('@') > 0;
            return (
              <div
                key={row.entry}
                style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.45rem 0.6rem', borderBottom: '1px solid #F1F5F9', background: isPrimary ? '#F0FDF4' : '#fff' }}
              >
                <input
                  type="checkbox"
                  checked={picked}
                  onChange={() => togglePick(row.entry)}
                  title={picked ? 'Keep this format on the company' : 'Not on the company'}
                  style={{ marginTop: 3, cursor: 'pointer', flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#1E40AF', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' }}>{row.entry}</span>
                    {picked && (
                      <span
                        title={isPrimary ? 'Used first when an address is guessed.' : 'Used when the tiers above it cannot build an address.'}
                        style={{ fontSize: '0.58rem', fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: isPrimary ? '#DCFCE7' : '#EFF6FF', color: isPrimary ? '#166534' : '#1D4ED8' }}
                      >{tier(idx)} TIER</span>
                    )}
                    {picked && domainPicks.length > 1 && (
                      <span style={{ display: 'inline-flex', gap: 2 }}>
                        <button type="button" disabled={idx === 0} title="Move up a tier" onClick={() => movePick(row.entry, -1)}
                          style={{ fontSize: '0.6rem', fontWeight: 600, fontFamily: 'inherit', padding: '0 5px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#fff', color: idx === 0 ? '#CBD5E1' : '#475569', cursor: idx === 0 ? 'default' : 'pointer' }}
                        >&#9650;</button>
                        <button type="button" disabled={idx === domainPicks.length - 1} title="Move down a tier" onClick={() => movePick(row.entry, 1)}
                          style={{ fontSize: '0.6rem', fontWeight: 600, fontFamily: 'inherit', padding: '0 5px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#fff', color: idx === domainPicks.length - 1 ? '#CBD5E1' : '#475569', cursor: idx === domainPicks.length - 1 ? 'default' : 'pointer' }}
                        >&#9660;</button>
                        {!isPrimary && (
                          <button type="button" title="Make this the 1st tier" onClick={() => makePrimary(row.entry)}
                            style={{ fontSize: '0.6rem', fontWeight: 600, fontFamily: 'inherit', padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#fff', color: '#475569', cursor: 'pointer' }}
                          >Make 1st</button>
                        )}
                      </span>
                    )}
                    {row.onRecord && (
                      <span style={{ fontSize: '0.58rem', fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: '#F1F5F9', color: '#64748B' }}>ON RECORD</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {row.suggested
                      ? `${row.votes} of the ${plural(row.domainCount, 'contact')} at ${row.domain} ${row.votes === 1 ? 'is' : 'are'} written this way.`
                      : hasPattern
                        ? 'Added by hand. No contact here is written this way.'
                        : 'Added by hand, and no naming pattern, so no address is built from it. It still pulls contacts on this domain onto the card.'}
                  </div>
                  {row.samples.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.1rem 0.5rem', marginTop: 2 }}>
                      {row.samples.map(s => (
                        <span key={s.email} style={{ fontSize: '0.66rem', color: '#475569' }}>
                          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{s.email}</span>
                          {s.name ? ` (${s.name})` : ''}
                        </span>
                      ))}
                      {row.votes > row.samples.length && (
                        <span style={{ fontSize: '0.66rem', color: '#94A3B8' }}>
                          and {row.votes - row.samples.length} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {quiet.length > 0 && (
            <div style={{ padding: '0.4rem 0.6rem', borderBottom: '1px solid #F1F5F9', fontSize: '0.66rem', color: '#94A3B8', lineHeight: 1.4 }}>
              Nothing to offer for {quiet.map(d => `${d.domain} (${plural(d.count, 'address')}, no shared convention)`).join(', ')}.
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.5rem 0.6rem', background: '#F8FAFC' }}>
            <span style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {domainPicks.length === 0
                ? 'Nothing ticked. Saving empties this field.'
                : `1st tier: ${domainPicks[0]}${domainPicks.length > 1 ? `, then ${domainPicks.length - 1} more` : ''}.`}
            </span>
            <span style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setDomainPickerOpen(false)}
                style={{ padding: '0.2rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.68rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
              >Cancel</button>
              <button
                type="button"
                onClick={() => { onChange(domainPicks.join('\n')); setDomainPickerOpen(false); }}
                style={{ padding: '0.2rem 0.5rem', border: '1px solid #86EFAC', borderRadius: 4, background: '#F0FDF4', color: '#166534', fontSize: '0.68rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
              >
                {domainPicks.length === 0 ? 'Save (empty)' : `Save ${plural(domainPicks.length, 'format')}`}
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
    </PopupListField>
  );
}
