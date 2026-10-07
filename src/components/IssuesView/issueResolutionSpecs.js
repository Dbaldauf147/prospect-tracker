import { buildListRegistry, resolveColumnLink } from '../common/columnLinks';
import { STATUSES, TIER_OPTIONS } from '../../data/enums';
import { HQ_REGION_OPTIONS } from '../../utils/hqRegion';
import { HANDOFF_FIELDS } from '../../utils/dealHandoff';
import { DEAL_IGNORED_KEY } from '../../utils/postSaleFollowUp';
import { updateDealFields } from '../../utils/dealsStore';
import { setClientStatus, setClientUntracked } from '../../utils/clientManagerStore';
import { setOppBfoLink } from '../../utils/opps2Store';
import { normalizeBfoCompany } from '../../utils/newBfoOpps';

// Resolution popups for the Issues tab. Each issue row the detectors in
// utils/clientIssues.js raise carries a `resolve` payload naming the data
// that would clear it; buildResolution turns that payload into a small
// form (which fields, what they hold now, where a save writes them), and
// IssueResolutionModal (IssueResolution.jsx) draws the form. Saving writes to the same store the
// owning page does, so the row drops off this tab once useIssues re-reads.
//
// The two issue types that already had their own popup (Service not in
// Dropdowns, Close Not Sold missing data) keep them; IssuesView routes to
// those directly and this module covers everything else.

// Which kinds of row open the dedicated popups rather than a form here.
export function resolutionKind(row) {
  if (row?.scopeFix) return 'service';
  if (row?.closeNotSold) return 'closeNotSold';
  return row?.resolve?.kind || null;
}

// The Clients tab's Renewal Status options: the Dropdowns list the user
// linked that column to, or none (free text) when it isn't linked.
function clientStatusOptions(settings, dropdownLists) {
  const link = resolveColumnLink('Status', settings?.clientsColumnLinks || {});
  if (!link) return null;
  const list = buildListRegistry(dropdownLists).get(link.listKey);
  return Array.isArray(list?.options) ? list.options.filter(o => String(o || '').trim()) : null;
}

// Same lookup MarketingLeadsView uses for its Status column.
function leadStatusOptions(dropdownLists) {
  const norm = s => String(s || '').trim().toLowerCase();
  const list = dropdownLists.find(l => !l.builtin && norm(l.label) === 'marketing lead status')
    || dropdownLists.find(l => l.key === 'marketingLeadStatus')
    || dropdownLists.find(l => norm(l.label) === 'marketing lead status');
  return Array.isArray(list?.options) ? list.options.filter(o => String(o || '').trim()) : [];
}

function writeDeal(ref, patch) {
  if (!ref) throw new Error('This deal could not be found in the Deals roster - fix it on the Deals subtab.');
  const res = updateDealFields(ref.index, ref.guard, patch);
  if (!res.ok) throw new Error(res.error);
}

// A field's `current` is what's stored now and `start` what the popup opens
// on (a suggested value, when there's an obvious one); Save turns on once
// any field differs from what's stored.
function field(key, label, type, current, extra = {}) {
  const cur = current ?? (type === 'checkbox' ? false : '');
  return { key, label, type, current: cur, start: extra.start ?? cur, ...extra };
}

const SERVICE_META_FIELDS = [
  { missing: 'Product Line', key: 'productLine' },
  { missing: 'Type', key: 'serviceType' },
  { missing: 'Region', key: 'region' },
  { missing: 'Local Project Name', key: 'localProjectName' },
];

// Opps offered for tagging a BFO Opportunity Name: the account's own opps
// first, then every other opp still open.
function oppChoices(records, account, oppNumbers) {
  const acct = normalizeBfoCompany(account);
  const label = (r) => {
    const n = oppNumbers?.get(r._id);
    const bits = [String(r.Account || '').trim() || '(no account)', String(r.Scope || '').trim(), String(r.Stage || '').trim()].filter(Boolean);
    const tag = String(r['BFO Link'] || '').trim();
    return `${n != null ? `#${n} ` : ''}${bits.join(' · ')}${tag && tag !== '-' ? ` (tagged: ${tag})` : ''}`;
  };
  const mine = [];
  const others = [];
  for (const r of records || []) {
    if (r?._id == null) continue;
    const opt = { value: String(r._id), label: label(r) };
    if (acct && normalizeBfoCompany(r.Account) === acct) mine.push(opt);
    else if (!/^(sold|not sold)$/i.test(String(r.Stage || '').trim())) others.push(opt);
  }
  others.sort((a, b) => a.label.localeCompare(b.label));
  return [
    ...(mine.length ? [{ group: `${account || 'This account'}'s opps`, options: mine }] : []),
    { group: 'Other open opps', options: others },
  ];
}

/**
 * The popup for one issue row, or null when nothing on it can be edited
 * from here. ctx: { prospect, settings, updateSettings, updateProspect,
 * dropdownLists, oppsRecords, oppNumbers, uid }.
 *
 * Returns { title, subtitle, note, fields, save(values) }.
 */
export function buildResolution(row, ctx) {
  const r = row?.resolve;
  if (!r) return null;
  const { prospect, settings, updateSettings, updateProspect, dropdownLists, uid } = ctx;
  const subtitle = row.company;
  const statusOpts = clientStatusOptions(settings, dropdownLists);

  switch (r.kind) {
    case 'contractExpired':
      return {
        title: 'Resolve expired contract',
        subtitle: r.agreement ? `${subtitle} · ${r.agreement}` : subtitle,
        note: 'A renewed End Date in the future, or Don\'t Track, clears this issue. The Renewal Status records where the renewal stands.',
        fields: [
          ...(r.deal ? [field('endDate', 'End Date (Deals subtab)', 'date', r.endDate)] : []),
          field('status', 'Renewal Status (Clients tab)', statusOpts ? 'select' : 'text', r.status, { options: statusOpts }),
          field('dontTrack', 'Don\'t Track this client\'s renewals', 'checkbox', false),
        ],
        async save(v, changed) {
          if (changed.endDate) writeDeal(r.deal, { 'End Date': v.endDate });
          if (changed.status) setClientStatus(row.company, v.status);
          if (changed.dontTrack) setClientUntracked(row.company, v.dontTrack);
        },
      };

    case 'renewalStatus':
      return {
        title: 'Set Renewal Status',
        subtitle,
        note: 'Any Renewal Status clears this issue. It is the same Status column as on the Clients tab.',
        fields: [field('status', 'Renewal Status (Clients tab)', statusOpts ? 'select' : 'text', r.status, { options: statusOpts })],
        async save(v) { setClientStatus(row.company, v.status); },
      };

    case 'dontTrack':
      return {
        title: 'Resolve missing expiration date',
        subtitle,
        note: 'Add the contract with its End Date on the Deals subtab, or stop tracking this client\'s renewals here.',
        fields: [field('dontTrack', 'Don\'t Track this client\'s renewals', 'checkbox', false)],
        async save(v) { setClientUntracked(row.company, v.dontTrack); },
      };

    case 'tier':
      if (!prospect) return null;
      return {
        title: 'Resolve tier mismatch',
        subtitle,
        note: `Target Accounts has this account at ${r.targetTier || '-'}. Match it, or keep your tier and stop flagging it.`,
        fields: [
          field('tier', 'Tier', 'select', prospect.tier || r.myTier, { options: TIER_OPTIONS, start: r.targetTier || prospect.tier }),
          field('ignore', 'Keep my tier and ignore this mismatch', 'checkbox', false),
        ],
        async save(v, changed) {
          const patch = {};
          if (changed.tier && !v.ignore) patch.tier = v.tier;
          if (v.ignore) patch.ignoreTierMismatch = true;
          await updateProspect(prospect.id, patch);
        },
      };

    case 'accountStatus':
      if (!prospect) return null;
      return {
        title: 'Resolve status mismatch',
        subtitle,
        note: `Opps suggests "${r.suggestedStatus}" for this account.`,
        fields: [
          field('status', 'Status', 'select', prospect.status || r.status, { options: STATUSES, start: r.suggestedStatus || prospect.status }),
          field('dismiss', 'Keep the current status and dismiss the suggestion', 'checkbox', false),
        ],
        async save(v, changed) {
          if (v.dismiss) await updateProspect(prospect.id, { dismissedSuggestedStatus: r.suggestedStatus });
          else if (changed.status) await updateProspect(prospect.id, { status: v.status });
        },
      };

    case 'hqRegion':
      if (!prospect) return null;
      return {
        title: 'Set HQ Region',
        subtitle,
        fields: [field('hqRegion', 'HQ Region', 'select', prospect.hqRegion, { options: HQ_REGION_OPTIONS })],
        async save(v) { await updateProspect(prospect.id, { hqRegion: v.hqRegion }); },
      };

    case 'leadStatus':
      return {
        title: 'Close out marketing lead',
        subtitle: r.company ? `${r.name} · ${r.company}` : r.name,
        note: 'Closed-Converted or Closed-Recycle clears this issue.',
        fields: [field('status', 'Lead Status', 'select', r.status, { options: leadStatusOptions(dropdownLists) })],
        async save(v) {
          const leads = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
          let hit = false;
          const next = leads.map((l) => {
            const same = r.leadId != null
              ? l?.id === r.leadId
              : String(l?.name || '').trim() === r.name && String(l?.company || '') === r.company;
            if (!same || hit) return l;
            hit = true;
            return { ...l, status: v.status };
          });
          if (!hit) throw new Error('That lead is no longer on the Marketing Leads list.');
          updateSettings({ marketingLeads: next });
        },
      };

    case 'tagBfoName':
      return {
        title: 'Tag BFO opp to an opp',
        subtitle,
        note: `Sets the BFO Opportunity Name of the opp you pick to "${r.bfoName}".`,
        fields: [field('oppId', 'Opp on Opps', 'select', '', { groups: oppChoices(ctx.oppsRecords, r.account, ctx.oppNumbers) })],
        async save(v) { await setOppBfoLink(uid, v.oppId, r.bfoName); },
      };

    case 'oppBfoLink':
      if (r.oppId == null) return null;
      return {
        title: 'Fix BFO Opportunity Name',
        subtitle: row.oppNumber != null ? `${subtitle} · Opp #${row.oppNumber}` : subtitle,
        note: r.suggestions.length
          ? 'Pick the name BFO Activity has for this account, or type the right one.'
          : 'Type the name exactly as BFO Activity shows it.',
        fields: [field('bfoLink', 'BFO Opportunity Name', 'text', r.bfoLink, { suggestions: r.suggestions })],
        async save(v) { await setOppBfoLink(uid, r.oppId, v.bfoLink.trim()); },
      };

    case 'newBfo': {
      const fields = [];
      const notes = [];
      if (r.missing.includes('BFO Company Name')) {
        if (prospect) fields.push(field('bfoCompanyName', 'BFO Company Name (company record)', 'text', prospect.bfoCompanyName));
        else notes.push('BFO Company Name needs a company in the Table View matching this account.');
      }
      const svc = SERVICE_META_FIELDS.filter(f => r.missing.includes(f.missing));
      if (svc.length && r.scope) {
        const cur = settings?.serviceOverrides?.[r.scope] || {};
        for (const f of svc) fields.push(field(f.key, `${f.missing} (Dropdowns › Services: ${r.scope})`, 'text', cur[f.key]));
      }
      if (r.missing.includes('Scope')) notes.push('Scope is set on the opp\'s row on Opps.');
      if (fields.length === 0) return null;
      return {
        title: 'Fill in New BFO Opp data',
        subtitle,
        note: notes.join(' ') || undefined,
        fields,
        async save(v, changed) {
          if (changed.bfoCompanyName) await updateProspect(prospect.id, { bfoCompanyName: v.bfoCompanyName.trim() });
          const svcChanged = svc.filter(f => changed[f.key]);
          if (svcChanged.length) {
            const all = { ...(settings?.serviceOverrides || {}) };
            const entry = { ...(all[r.scope] || {}) };
            for (const f of svcChanged) {
              const val = String(v[f.key] || '').trim();
              if (val) entry[f.key] = val; else delete entry[f.key];
            }
            if (Object.keys(entry).length) all[r.scope] = entry; else delete all[r.scope];
            updateSettings({ serviceOverrides: all });
          }
        },
      };
    }

    case 'contracting':
      if (!prospect) return null;
      return {
        title: 'Add contracting entity info',
        subtitle,
        note: 'Saved to the company record (Company tab on the company popup).',
        fields: [
          field('contractingEntity', 'Contracting Entity', 'text', prospect.contractingEntity),
          field('contractingEntityAddress', 'Contracting Entity Address', 'textarea', prospect.contractingEntityAddress),
        ],
        async save(v, changed) {
          const patch = {};
          if (changed.contractingEntity) patch.contractingEntity = v.contractingEntity.trim();
          if (changed.contractingEntityAddress) patch.contractingEntityAddress = v.contractingEntityAddress.trim();
          await updateProspect(prospect.id, patch);
        },
      };

    case 'followUp':
      if (!r.deal) return null;
      return {
        title: 'Log post-sale follow-up',
        subtitle: r.agreement ? `${subtitle} · ${r.agreement}` : subtitle,
        note: 'A Follow Up On Sale date, N/A, or ignoring the deal clears this issue.',
        fields: [
          field('date', 'Follow Up On Sale', 'date', ''),
          field('na', 'No follow-up needed (mark N/A)', 'checkbox', false),
          field('ignore', 'Ignore this deal (as on the Deals subtab)', 'checkbox', false),
        ],
        async save(v, changed) {
          const patch = {};
          if (v.na) patch['Follow Up On Sale'] = 'N/A';
          else if (changed.date) patch['Follow Up On Sale'] = v.date;
          if (v.ignore) patch[DEAL_IGNORED_KEY] = '1';
          writeDeal(r.deal, patch);
        },
      };

    case 'handoff': {
      if (!r.deal) return null;
      const defs = HANDOFF_FIELDS.filter(f => r.missing.includes(f.key));
      return {
        title: 'Complete handoff items',
        subtitle: r.agreement ? `${subtitle} · ${r.agreement}` : subtitle,
        note: 'The outstanding steps on this deal\'s Progress checklist.',
        fields: [
          ...defs.map(f => field(
            f.key, f.label,
            f.date ? 'date' : f.yesno ? 'select' : 'text',
            r.values?.[f.key],
            f.yesno ? { options: ['Yes', 'No'] } : {},
          )),
          field('ignore', 'Ignore this deal (as on the Deals subtab)', 'checkbox', false),
        ],
        async save(v, changed) {
          const patch = {};
          for (const f of defs) if (changed[f.key]) patch[f.key] = typeof v[f.key] === 'string' ? v[f.key].trim() : v[f.key];
          if (v.ignore) patch[DEAL_IGNORED_KEY] = '1';
          writeDeal(r.deal, patch);
        },
      };
    }

    default:
      return null;
  }
}

