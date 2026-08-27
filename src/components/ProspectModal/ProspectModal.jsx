import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { TAG_OPTIONS, TAG_SCORE_EXCLUDED, MET_IN_PERSON_TAG, recordKeepsTag, tagStateFrom, withTagAnswer, withTagStatus, tagKey, findTagRecord } from '../../utils/contactTagReview';

// Header cells for the tag table's two column groups (Answer / Status) and
// for the choices under them. Hoisted out of the render so the two header
// rows can't drift apart on padding or weight.
const GROUP_HEAD = {
  textAlign: 'center', padding: '0.25rem 0.1rem 0',
  fontWeight: 700, fontSize: '0.54rem',
  textTransform: 'uppercase', letterSpacing: '0.06em',
};
const COL_HEAD = {
  width: 54, textAlign: 'center', padding: '0.3rem 0.1rem',
  fontWeight: 700, fontSize: '0.58rem',
  textTransform: 'uppercase', letterSpacing: 0, whiteSpace: 'nowrap',
};
import { stripDashes, sanitizeExcelWorkbook } from '../../utils/exportSanitize.js';
import { createPortal } from 'react-dom';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { OpportunityForm, DEFAULT_FORM_TEMPLATE } from './OpportunityForm';
import { ScopingNotesEditor, harvestCompetitors } from './ScopingNotesEditor';
import { loadEffectiveRaClients, raClientName, raClientCm } from '../../utils/raClientsStore';
import { STATUSES, STATUS_COLORS, TIERS, GEOGRAPHIES, PUBLIC_PRIVATE, FRAMEWORKS, SERVICE_CATEGORIES, SERVICE_STATUSES, COUNTRIES, US_STATES, PE_STAGES } from '../../data/enums';
import { getServiceCategories } from '../../utils/serviceCategoriesStore';
import { CITY_OPTIONS, matchCities, getStateForCity, lookupStateForCity } from '../../data/cities';
import { DEFAULT_EMAIL_SIGNATURE } from '../../data/emailSignature';
import { useAuth } from '../../contexts/AuthContext';
import { saveSourceFile as savePortfolioSourceFileToIDB, loadSourceFile as loadPortfolioSourceFileFromIDB, clearSourceFile as clearPortfolioSourceFileFromIDB, renameSourceFile as renamePortfolioSourceFile } from '../../utils/portfolioSourceFileStore';
import { computeListFlags, LIST_FLAG_BY_LABEL } from '../../utils/listFlags';
import { reportingStatus, REPORTED_COLORS, NOT_REPORTED_COLORS } from '../../utils/reportingFrameworks';
import { splitPeOwners } from '../../utils/peOwners';
import { isTryingAgain, tryingAgainTitle, TRYING_AGAIN, TRYING_AGAIN_COLORS } from '../../utils/tryingAgain';
import { serviceStatusColor } from '../../utils/serviceStatusColors';
import { scopeTokens, scopeTokenMatchesService } from '../../utils/scopeMatch';
import {
  SCHEDULED_OPP_COLORS,
  formatScheduledOppDay,
  normalizeScheduledOpps,
  scheduledOppChipTitle,
  scheduledServicesForCompany,
} from '../../utils/scheduledOpps';
import { loadOpps2Newest, bulkSetOppField } from '../../utils/opps2Store';
import { withCompanyOverride } from '../../utils/contactCompanyOverride';
import { buildCompanyRenamePlan, planHasWork, summarizeRenamePlan, applyListMappingWrites } from '../../utils/companyRenameCascade';
import { countClientsSubtabRename, clientsSubtabRenameTotal, summarizeClientsSubtabRename, applyClientsSubtabRename } from '../../utils/clientsRename';
import { loadTargetAccountsFromDB, saveTargetAccountsToDB, renameTargetAccountRows, countBlockedAccountRename, renameBlockedAccountName } from '../TargetAccountsView/TargetAccountsView';
import { planSiteListRename, summarizeSiteListRename, applySiteListRename } from '../MasterSiteListView/siteListRename';
import { renameCompanySiteListEntry } from '../MasterSiteListView/siteListRenameRules';
import { readSheetSync } from '../../utils/sheetSyncSettings';
import { planSheetCompanyRename, spreadsheetIdFromUrl } from '../../utils/sheetCompanyRename';
import { computePortfolioFitScore, siteCountNumber, industrySector, sectorScoreFor, tierForScoreValue, industryTier, downloadPortfolioCompaniesWorkbook } from '../../utils/portfolioCompaniesWorkbook';
import { SiteListPasteModal } from './SiteListPasteModal';
import { siteListFacts as computeSiteListFacts, formatSqft } from '../../utils/siteListFacts';
import { isContactInEvent, toggleContactInEvents } from '../../utils/eventsStore';
// Aliased: `setClientManager` is also the name of this modal's own state
// setter for the resolved value.
import {
  loadClientManagerMap, setClientManager as saveClientManager, CLIENT_MANAGER_EVENT,
} from '../../utils/clientManagerStore';
import { TagMultiSelect } from '../common/TagMultiSelect';
import { buildStrategyOptions, persistCustomStrategy, buildAssetTypeOptions, buildCdmOptions, buildTypeOptions } from '../../utils/prospectOptions';
import { resolveTargetAccountCdm } from '../../utils/cdmMatch';
import {
  divisionsFor,
  divisionParentsFor,
  setDivisionParentPatch,
  buildDivisionTree,
  addNamedDivisionPatch,
  renameDivisionPatch,
  removeDivisionPatch,
  divisionContactsFor,
  divisionContactKey,
  addDivisionContactPatch,
  removeDivisionContactPatch,
  moveDivisionContactsPatch,
  groupDivisionContactsByTeam,
  divisionLayoutFor,
  setDivisionLayoutPatch,
  buildDivisionContactTree,
  nameKey,
} from '../../utils/divisions';
import { CommitOnBlurInput } from '../common/CommitOnBlurInput';
import { SENTIMENT_OPTIONS, sentimentFor, sentimentMark } from '../../utils/contactSentiment';
import { getHubspotCache, updateHubspotCache, notifyCacheUpdated, setHubspotCachePreservingManual } from '../../utils/hubspotContactsCache';
import { hubspotFailureDetail } from '../../utils/hubspotFailureDetail';
import { userLsGet } from '../../utils/userLs';
import { dbGet } from '../../utils/db';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { subscribeIndicativeAnalysisMeta, loadIndicativeAnalysis } from '../../utils/firestoreSync';
import { ListsMatchPanel } from './ListsMatchPanel';
import styles from './ProspectModal.module.css';

async function loadOppsFromIndexedDB() {
  try { return await loadOppsFromCache(); }
  catch { return null; }
}

async function loadClientsFromIndexedDB() {
  try { return (await dbGet('clients-cache', 'data')) || null; }
  catch { return null; }
}

// Client Manager assigned on the Clients page lives in the shared
// clients-manager-map (keyed by the company name lowercased + trimmed,
// the same normalization ClientsView uses). Resolve it for a company so
// the modal can auto-populate the read-only Client Manager field. Falls
// back to a fuzzy companiesMatch scan so slight name drift (e.g.
// "Blue Owl" vs "Blue Owl Capital") still resolves. Returns null when
// the company has no manager assigned on the Clients page.
function resolveClientManagerFromMap(company) {
  if (!company) return null;
  const map = loadClientManagerMap();
  const key = String(company).trim().toLowerCase();
  if (map[key]) return map[key];
  for (const [k, v] of Object.entries(map)) {
    if (v && companiesMatch(k, company)) return v;
  }
  return null;
}

// Inline editable input rendered in place of a form tab's title span
// while the tab is in rename mode. Keeps its own draft so React renders
// from the parent state don't clobber what the user is typing; commits
// on Enter / blur and cancels on Escape. autoFocus + selecting the
// existing text means a fresh "+ Option" tab opens straight into a
// ready-to-type input.
function InlineRenameInput({ initial, onSubmit, onCancel }) {
  const [draft, setDraft] = useState(initial ?? '');
  const inputRef = useRef(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSubmit(draft);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onSubmit(draft)}
      style={{
        flex: 1,
        minWidth: 0,
        border: '1px solid #94A3B8',
        borderRadius: 4,
        padding: '0.15rem 0.35rem',
        fontSize: '0.78rem',
        fontFamily: 'inherit',
        color: '#1E293B',
        background: '#fff',
      }}
    />
  );
}

function buildDefaultOpportunityTemplate(dateLine, timeLine) {
  return [
    `<p><em>${dateLine} · ${timeLine}</em></p>`,
    '<p><strong>ESS Call Plan</strong>: Advanced Collaboration Tools</p>',
    '<h2>Intent</h2>',
    '<p>To find out if they have any needs we can address</p>',
    '<h2>End In Mind</h2>',
    '<p>To mutually determine whether or not there is something else we should explore further</p>',
    '<p><em>Client Validated?</em> ☐</p>',
    '<h2>Meeting Filters</h2>',
    '<ol>',
    '<li data-list="checked">Customer focused</li>',
    '<li data-list="checked">Requires a decision</li>',
    '<li data-list="checked">Logical, realistic and appropriate for the meeting</li>',
    '<li data-list="checked">Makes no an OK choice</li>',
    '<li data-list="checked">Singular ask for the client?</li>',
    '<li data-list="unchecked">Should we be talking?</li>',
    '<li data-list="unchecked">Should we keep talking?</li>',
    '<li data-list="unchecked">Should you do this?</li>',
    '<li data-list="unchecked">Should you do this with us?</li>',
    '</ol>',
    '<p><em>Insert everything from key people to issues from previous call.</em></p>',
    '<p><em>Insert Agenda, timing, with SME asks as well.</em></p>',
    '<h2>What Key Beliefs Must They Have</h2>',
    '<ul>',
    '<li>Get this from the evidence</li>',
    '<li>Something we know they should be thinking about based on our previous experience with clients</li>',
    '</ul>',
    '<h3>How Will You Address Those Key Beliefs</h3>',
    '<p><br></p>',
    '<h2>Our Questions (What and How)</h2>',
    '<ul>',
    '<li>What are you currently trying to solve for?</li>',
    '<li>Are they facing any pressure from investors or other stakeholders on ESG?</li>',
    '<li>How do you buy energy?</li>',
    '<li>How are you managing your energy data?</li>',
    '</ul>',
    '<h3>Their Answers</h3>',
    '<p><br></p>',
    '<h2>What Questions They Might Ask</h2>',
    '<ul>',
    '<li>Who else have you worked with in our industry/vertical?</li>',
    '</ul>',
    '<h3>How Will You Respond?</h3>',
    '<ul>',
    '<li>Our clients have confidentiality clauses in their agreements. We can say we are working with Blackstone as their system of record.</li>',
    '</ul>',
    '<h2>Yellow Lights: Possible Doubts, Concerns, or Objections</h2>',
    '<ul>',
    '<li>We already have someone who handles our procurement/utility bills</li>',
    '</ul>',
    '<h3>How Will You Respond? (Soften, State Your Concern, Hand It Back)</h3>',
    '<ul>',
    '<li>Oh great. How did you choose this company?</li>',
    '</ul>',
    '<h2>What Next Steps Are We Hoping Will Happen?</h2>',
    '<ul>',
    '<li>Item 1</li>',
    '<li>Item 2</li>',
    '</ul>',
    '<h2>Agenda</h2>',
    '<ul>',
    '<li>Agenda overview · Introduction of ESS Team: Dan (02:00)</li>',
    '<li>RFP questions (listed in the Call Plan): Dan (10:00)</li>',
    '<li>Ashley\'s questions: Ashley (15:00)</li>',
    '<li>Stephanie\'s questions: Stephanie (15:00)</li>',
    '<li>Mike\'s questions: Chelsea (15:00)</li>',
    '<li>Final GIC questions and next step discussions: Mike</li>',
    '</ul>',
  ].join('');
}

function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Ultra-tolerant equality. Normalizes Unicode (NFKD), drops
  // diacritics, replaces every non-letter/digit with a single
  // space, collapses whitespace, then compares. Catches the case
  // where one side has a non-breaking space, smart-quote paren,
  // or different punctuation that breaks ===.
  const flatten = (s) => String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const fa = flatten(na);
  const fb = flatten(nb);
  if (fa && fb && fa === fb) return true;
  // Whitespace-collapsed equality on the original lower-trimmed
  // strings — catches copy/paste variants with double spaces.
  const squish = (s) => s.replace(/\s+/g, ' ').trim();
  if (squish(na) === squish(nb)) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa === sb) return true;
  const sLonger = sa.length >= sb.length ? sa : sb;
  const sShorter = sa.length >= sb.length ? sb : sa;
  if (sShorter.length >= 4 && sShorter.length >= sLonger.length * 0.6 && sLonger.includes(sShorter)) return true;
  // Acronym / single-token match. Catches "TIAA" vs
  // "(TIAA) Teachers Insurance and Annuity Association of America"
  // and "JLL" vs "Jones Lang LaSalle (JLL)" by treating parens
  // as word separators.
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    if (tokensOf(longer).includes(sTokens[0])) return true;
  }
  return false;
}

// ── Org Chart — 5-Bucket View ──

function getOrgKey(company) {
  return `orgchart-${(company || '').toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

const BUCKETS = [
  { key: 'esg',             label: 'ESG',              tag: 'esg',              accent: '#059669', bg: '#ECFDF5', border: '#6EE7B7', headerBg: '#D1FAE5', headerColor: '#065F46' },
  { key: 'procurement',    label: 'Procurement',      tag: 'procurement',     accent: '#7C3AED', bg: '#F5F3FF', border: '#C4B5FD', headerBg: '#EDE9FE', headerColor: '#4C1D95' },
  { key: 'utilities',      label: 'Utilities',        tag: 'utilities',       accent: '#2563EB', bg: '#EFF6FF', border: '#93C5FD', headerBg: '#DBEAFE', headerColor: '#1E3A8A' },
  { key: 'climaterisk',    label: 'Climate Risk',     tag: 'climate risk',    accent: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5', headerBg: '#FEE2E2', headerColor: '#7F1D1D' },
  { key: 'capitalplanning',label: 'Capital Planning', tag: 'capital planning',accent: '#D97706', bg: '#FFFBEB', border: '#FDE68A', headerBg: '#FEF3C7', headerColor: '#78350F' },
  { key: 'efficiencyrenewables', label: 'Efficiency / Renewables', tag: 'efficiency / renewables', accent: '#0D9488', bg: '#F0FDFA', border: '#5EEAD4', headerBg: '#CCFBF1', headerColor: '#134E4A' },
];

function contactHasTag(c, tag) {
  return getContactTags(c).includes(tag.toLowerCase());
}

function contactIsHidden(c) {
  return contactHasTag(c, 'hide');
}

function getContactTags(c) {
  const raw = c.dans_tags || c.dan_s_tags || c.dans_tag || '';
  return raw.split(';').map(t => t.trim().toLowerCase()).filter(Boolean);
}

function OrgChart({ contacts, onDeleteContact, deletingContact, onEditContact, reportsTo = {} }) {
  if (contacts.length === 0) {
    return <div style={{ fontSize: '0.78rem', color: '#9CA3AF', fontStyle: 'italic', padding: '1rem 0' }}>No contacts to display</div>;
  }

  const idOf = (c) => String(c.id || c.vid || c.email || '');

  // Build a parent→children map using the full contact set (not per-bucket).
  const byId = new Map(contacts.map(c => [idOf(c), c]));
  const childrenByParent = new Map();
  const hasManager = new Set();
  for (const c of contacts) {
    const cid = idOf(c);
    const mgrs = (reportsTo[c.id || c.vid] || []).map(String);
    const firstMgrInSet = mgrs.find(m => byId.has(m));
    if (firstMgrInSet) {
      hasManager.add(cid);
      if (!childrenByParent.has(firstMgrInSet)) childrenByParent.set(firstMgrInSet, []);
      childrenByParent.get(firstMgrInSet).push(c);
    }
  }
  // Roots: contacts with no manager in the set AND who have at least one report.
  // Orphans: contacts with no manager in the set AND no reports either.
  const roots = [];
  const orphans = [];
  for (const c of contacts) {
    const cid = idOf(c);
    if (hasManager.has(cid)) continue;
    const hasReports = (childrenByParent.get(cid) || []).length > 0;
    const isDM = contactHasTag(c, 'decision maker');
    if (hasReports || isDM) roots.push(c);
    else orphans.push(c);
  }

  function ContactCard({ contact }) {
    const name = [contact.firstname, contact.lastname].filter(Boolean).join(' ') || '-';
    const isDM = contactHasTag(contact, 'decision maker');
    const isDeleting = deletingContact === (contact.id || contact.vid);
    const matchedBuckets = BUCKETS.filter(b => getContactTags(contact).includes(b.tag));

    return (
      <div
        onClick={() => onEditContact && onEditContact(contact)}
        style={{
          background: isDM ? '#FEFCE8' : '#fff',
          border: isDM ? '2px solid #F59E0B' : '1px solid #E2E8F0',
          borderRadius: '6px',
          padding: '0.45rem 0.55rem',
          position: 'relative',
          cursor: 'pointer',
          minWidth: '180px',
          maxWidth: '240px',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
        onMouseLeave={e => e.currentTarget.style.background = isDM ? '#FEFCE8' : '#fff'}
      >
        {onDeleteContact && (
          <button
            onClick={e => { e.stopPropagation(); onDeleteContact(contact); }}
            disabled={isDeleting}
            title="Delete contact"
            style={{ position: 'absolute', top: '3px', right: '3px', background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.78rem', cursor: 'pointer', lineHeight: 1, padding: '1px 3px', zIndex: 1 }}
            onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
            onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
          >{isDeleting ? '…' : '×'}</button>
        )}
        <div style={{ fontWeight: 700, fontSize: '0.74rem', color: '#1E293B', paddingRight: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {name}
          {isDM && <span style={{ fontSize: '0.5rem', fontWeight: 700, color: '#92400E', background: '#FDE68A', padding: '0px 4px', borderRadius: '3px', flexShrink: 0 }}>DM</span>}
        </div>
        {contact.jobtitle && (
          <div style={{ fontSize: '0.62rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>{contact.jobtitle}</div>
        )}
        {matchedBuckets.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '4px' }}>
            {matchedBuckets.map(b => (
              <span key={b.key} style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.55rem', fontWeight: 700, background: b.headerBg, color: b.headerColor, whiteSpace: 'nowrap' }}>
                {b.label}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const rendered = new Set();
  function renderNode(c) {
    const id = idOf(c);
    if (rendered.has(id)) return null;
    rendered.add(id);
    const kids = childrenByParent.get(id) || [];
    return (
      <div key={id}>
        <ContactCard contact={c} />
        {kids.length > 0 && (
          <div style={{ marginLeft: 12, marginTop: 0, borderLeft: '2px solid #94A3B8' }}>
            {kids.map(k => (
              <div key={idOf(k)} style={{ display: 'flex', alignItems: 'flex-start', marginTop: '0.4rem' }}>
                <div style={{ width: 10, height: 16, borderBottom: '2px solid #94A3B8', flexShrink: 0 }} />
                <div style={{ flex: 1, paddingLeft: 4, minWidth: 0 }}>
                  {renderNode(k)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Coverage check: which buckets currently have no contacts tagged?
  const missingBuckets = BUCKETS.filter(b => !contacts.some(c => getContactTags(c).includes(b.tag)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {missingBuckets.length > 0 && (
        <div style={{ padding: '0.5rem 0.7rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6 }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#92400E', marginBottom: '0.3rem' }}>
            No contacts found for these categories
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {missingBuckets.map(b => (
              <span key={b.key} style={{ padding: '2px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: b.headerBg, color: b.headerColor, border: `1px solid ${b.border}` }}>
                {b.label}
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', alignItems: 'flex-start', paddingBottom: '0.25rem' }}>
      {/* Main hierarchy — roots and their direct/indirect reports. Peer roots render
          side-by-side so multiple independent decision makers sit next to each other
          instead of stacked vertically. */}
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '0.75rem 1rem' }}>
        {roots.length === 0 && orphans.length === contacts.length ? (
          <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic' }}>
            No reporting relationships set. Open a contact and pick a manager under &quot;Reports To&quot; to build the tree.
          </div>
        ) : roots.map(r => (
          <div key={idOf(r)} style={{ flex: '0 0 auto' }}>{renderNode(r)}</div>
        ))}
      </div>

      {/* Orphans — contacts with no relationships, shown off to the side */}
      {orphans.length > 0 && (
        <div style={{ flex: '0 0 240px', borderLeft: '1px solid var(--color-border-light)', paddingLeft: '0.75rem' }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
            Unlinked
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {orphans.map(c => <ContactCard key={idOf(c)} contact={c} />)}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}


// A data-only deal is billed per utility account per month, so a company's
// account count is most of the way to what the deal is worth in a year.
// The Scale section shows that annualised figure beside the count.
const DATA_DEAL_PER_ACCOUNT_MONTH = 5;

const EMPTY = {
  company: '', cdm: '', status: 'Inside Sales', type: '', geography: '', publicPrivate: '',
  assetTypes: [], peAum: null, reAum: null, numberOfSites: null, numberOfAccounts: null, rank: '', tier: 'Tier 3',
  hqRegion: '', frameworks: [], frameworkSources: {}, notes: '', website: '', emailDomain: '', aliases: '', servicesExplored: {}, serviceNotes: {}, serviceSMEs: {}, competitors: {}, portfolioCompanies: [],
  peOwner: '', sustainabilityTargets: '', caseStudyCreated: false, peStage: '', bfoCompanyName: '', contractingEntity: '', strategies: [], revenue: '',
  // Opts this company into the weekly acquisition-news digest
  // (api/company-news-scheduler). Off unless explicitly ticked.
  trackAcquisitionNews: false,
  salesPartner: '',
};

// Company-name normalizer shared with the list tabs so fuzzy matching
// lines up: lowercased, accent-stripped, punctuation removed, common
// corporate suffixes dropped.
const PORTFOLIO_CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holding|holdings|group|grp)\b\.?/g;
function normalizePortfolioCompany(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(PORTFOLIO_CORP_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Merge per-company numbers from the main Portfolio Companies sheet
// into the Top 5 Overview sheet's Multi-site Billing and Energy cells
// so the exported cell reads e.g. "Strong - 35 sites" or "Strong - 142
// GWh/yr". Mutates `overview` in place and drops any pre-existing
// Site Count column (the number lives inside the Multi-site Billing
// cell now).
function enrichOverviewFromPortfolio(overview, portfolioRows) {
  if (!overview || !Array.isArray(overview.headers) || !Array.isArray(overview.rows)) return;
  if (!Array.isArray(portfolioRows) || portfolioRows.length === 0) return;

  const overviewHeaders = overview.headers;
  const findIdx = (pred) => overviewHeaders.findIndex(h => pred(String(h || '')));
  const ovCompanyIdx = findIdx(s => /company|^name$|portfolio/i.test(s.replace(/[^a-z0-9]/gi, '')));
  const ovBillingIdx = findIdx(s => /multi.?site.*billing|multisite\s*billing/i.test(s));
  const ovEnergyIdx = findIdx(s => /^\s*energy\s*$|energy\s*(usage|intensity|consumption|fit|score|profile)?/i.test(s));
  if (ovCompanyIdx < 0) return;

  // Detect the main-tab headers by scanning the first row's keys.
  const mainHeaders = Object.keys(portfolioRows[0] || {});
  const mainHdr = (pred) => mainHeaders.find(h => pred(String(h || '')));
  const mainCompanyKey = mainHdr(s => /company|portfolio/i.test(s));
  const mainSiteKey = mainHdr(s => /site\s*count|^sites?$|number\s*of\s*sites?|est\.?\s*site/i.test(s));
  const mainEnergyKey = mainHdr(s => /energy|gwh/i.test(s));

  // Build a normalized name → { sites, energy } lookup from the main
  // portfolio data so overview-row enrichment is O(rows + portfolio).
  const byNorm = new Map();
  for (const r of portfolioRows) {
    const rawName = mainCompanyKey ? r[mainCompanyKey] : '';
    const norm = normalizePortfolioCompany(rawName);
    if (!norm) continue;
    const sites = mainSiteKey ? r[mainSiteKey] : '';
    const energy = mainEnergyKey ? r[mainEnergyKey] : '';
    // First-seen wins; the main portfolio table shouldn't repeat companies.
    if (!byNorm.has(norm)) byNorm.set(norm, { sites, energy });
  }

  const rowCells = (r) => (Array.isArray(r) ? r : (r?.cells || []));

  function matchByName(overviewName) {
    const norm = normalizePortfolioCompany(overviewName);
    if (!norm) return null;
    if (byNorm.has(norm)) return byNorm.get(norm);
    // Substring fallback for portfolio brands that include a division
    // ("Blue Owl Real Estate" in overview ↔ "Blue Owl" on main tab).
    let best = null;
    for (const [n, v] of byNorm) {
      if (n.length < 3) continue;
      if (n === norm || n.includes(norm) || norm.includes(n)) {
        if (!best || n.length > best.n.length) best = { n, v };
      }
    }
    return best?.v || null;
  }

  function parseNumber(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const cleaned = String(v).replace(/[^0-9.\-]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function appendSuffix(cellVal, suffix) {
    const raw = String(cellVal ?? '').replace(/\s+$/, '');
    if (!raw) return suffix.replace(/^\s*-\s*/, '');
    // Avoid duplicating when the user has run the export twice.
    const stripped = suffix.replace(/^\s*-\s*/, '');
    if (raw.toLowerCase().includes(stripped.toLowerCase())) return raw;
    return `${raw}${suffix}`;
  }

  overview.rows = overview.rows.map((r) => {
    const cells = rowCells(r).slice();
    const name = cells[ovCompanyIdx];
    const match = matchByName(name);
    if (!match) return { cells };
    if (ovBillingIdx >= 0) {
      const sitesNum = parseNumber(match.sites);
      if (sitesNum != null && sitesNum > 0) {
        cells[ovBillingIdx] = appendSuffix(cells[ovBillingIdx], ` - ${sitesNum.toLocaleString()} ${sitesNum === 1 ? 'site' : 'sites'}`);
      }
    }
    if (ovEnergyIdx >= 0) {
      const energyNum = parseNumber(match.energy);
      if (energyNum != null && energyNum > 0) {
        const energyLabel = `${energyNum.toLocaleString(undefined, { maximumFractionDigits: 1 })} GWh/yr`;
        cells[ovEnergyIdx] = appendSuffix(cells[ovEnergyIdx], ` - ${energyLabel}`);
      }
    }
    return { cells };
  });

  // Drop any Site Count column that got baked in by the earlier
  // pipeline — its data lives inside Multi-site Billing now.
  const siteCountIdx = overviewHeaders.findIndex(h => /^\s*site\s*count\s*$/i.test(String(h || '')));
  if (siteCountIdx >= 0) {
    overview.headers = overviewHeaders.filter((_, i) => i !== siteCountIdx);
    overview.rows = overview.rows.map(r => ({
      cells: rowCells(r).filter((_, i) => i !== siteCountIdx),
    }));
  }
}

// ── Inline HubSpot Contact Editor ──
// "Met In Person" is no longer offered as a selectable tag — it's surfaced
// as a dedicated checkbox in the editor below. Under the hood the flag is
// still persisted as a `dans_tags` value (so existing tagged contacts show
// up checked automatically and the PE Portfolio "Met in Person" counts keep
// working); the checkbox just reads/writes that one value.


// Portfolio-company sector scoring. Each sector has a 1-10 fit score; the tier
// bucket (High/Medium/Low) is derived from the score for color-coding only.
const TIER_COLORS = {
  High: { bg: '#DCFCE7', color: '#166534', border: '#86EFAC' },
  Medium: { bg: '#FEF9C3', color: '#854D0E', border: '#FDE68A' },
  Low: { bg: '#F1F5F9', color: '#475569', border: '#CBD5E1' },
};






const PORTFOLIO_FIELD_OPTIONS = [
  { key: '', label: '(Ignore this column)' },
  { key: 'companyName', label: 'Company Name (required)' },
  { key: 'status', label: 'Status' },
  { key: 'opportunityScore', label: 'Opportunity Score (0-100)' },
  { key: 'sector', label: 'Sector' },
  { key: 'subsector', label: 'Subsector' },
  { key: 'subsectorScore', label: 'Subsector Score (1-10)' },
  { key: 'sectorScore', label: 'Sector Score (1-10)' },
  { key: 'hqCity', label: 'HQ City' },
  { key: 'hqCountry', label: 'HQ Country' },
  { key: 'energyGwh', label: 'Est. Energy (GWh/yr)' },
  { key: 'estElectricity', label: 'Est. Electricity' },
  { key: 'estNaturalGas', label: 'Est. Natural Gas' },
  { key: 'siteCount', label: 'Est. Site Count' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'pcDescription', label: 'PC Description' },
  { key: 'acquisitionYear', label: 'Acquisition Year' },
  { key: 'notes', label: 'Notes' },
  { key: 'raClientMatch', label: 'RA Client Match' },
  { key: 'clientManager', label: 'Client Manager' },
  { key: 'targetAccount', label: 'Target Account' },
];

// Status column on the Portfolio Companies table. A portfolio company is a
// prospect in its own right, so the column reuses the tracker's own STATUSES
// vocabulary and colors rather than inventing a second one — a PC that gets
// worked reads the same way here as it does on the main table.
//
// A row with no status of its own inherits the status of the tracker record
// with the same company name (rendered dimmed, with the source in the
// tooltip), so companies already mapped into the tracker show where they
// stand without anyone re-typing it. Picking a status on the row overrides
// the inherited one and is what the export writes.
function portfolioStatusColor(status) {
  return STATUS_COLORS[status] || '#475569';
}

// { status, from } for one portfolio company row: the row's own status when
// set, otherwise the matching tracker record's. `byName` is the normalized
// name → status map built once per render from the prospect list.
function resolvePortfolioStatus(row, byName) {
  const own = String(row?.status || '').trim();
  if (own) return { status: own, from: '' };
  const name = String(row?.companyName || '').trim();
  if (!name || !byName || byName.size === 0) return { status: '', from: '' };
  const exact = byName.get(name.toLowerCase());
  if (exact) return { status: exact.status, from: exact.company };
  for (const entry of byName.values()) {
    if (entry.status && companiesMatch(entry.company, name)) return { status: entry.status, from: entry.company };
  }
  return { status: '', from: '' };
}

// The tracker record a portfolio company row refers to, or null when the
// company isn't on Table View. Same two-step match resolvePortfolioStatus
// uses — exact name first, then the fuzzy company compare — so a row that
// shows an inherited status is always one you can open, and vice versa.
//
// Unlike the status map this doesn't require the record to have a status:
// "is this company in the tracker" and "does it have a status" are different
// questions, and the answer to the first is what decides whether there's
// anything to open.
function findPortfolioProspect(row, byName) {
  const name = String(row?.companyName || '').trim();
  if (!name || !byName || byName.size === 0) return null;
  const exact = byName.get(name.toLowerCase());
  if (exact) return exact;
  for (const p of byName.values()) {
    if (companiesMatch(p.company, name)) return p;
  }
  return null;
}


// City → State / Country lookup (curated list + Nominatim geocoder
// fallback) now lives in ../../data/cities so the All Contacts table
// can share the exact same auto-fill behavior as this modal.

export const ContactEditModal = memo(function ContactEditModal({ contact, onSave, onClose, tagOptions = TAG_OPTIONS, contactNotes = {}, onSaveNote, contactOldEmails = {}, onSaveOldEmails, contactOldCompany = {}, onSaveOldCompany, onSaveCompanyOverride, contactNicknames = {}, onSaveNickname, contactTeamNames = {}, onSaveTeamName, contactReportsTo = {}, onSaveReportsTo, ccMap = {}, onSaveCcMap, toAlsoMap = {}, onSaveToAlsoMap, contactFamilies = {}, onSaveFamily, contactMetInPerson = {}, onSaveMetInPerson, contactInvitedToLouisville = {}, onSaveInvitedToLouisville, contactSentiment = {}, onSaveSentiment, contactTagReview = {}, onSaveTagReview, events = [], onToggleContactEvent, companyContacts = [], allContacts = null, emailDomains = [], companyNames = [] }) {
  const rawTags = contact.dans_tags || contact.dan_s_tags || contact.dans_tag || '';
  // Parse existing tags; track which known tags are checked separately from free-text extras
  const parsedTags = rawTags.split(';').map(t => t.trim()).filter(Boolean);
  // "Met In Person" is handled by its own checkbox, never as a tag chip —
  // strip it from the offered options regardless of what a caller passes in.
  const metLower = MET_IN_PERSON_TAG.toLowerCase();
  const visibleTagOptions = tagOptions.filter(t => t.toLowerCase() !== metLower);
  // Matched on the spacing-insensitive key, not the raw string: this
  // dataset carries both "Efficiency / Renewables" and
  // "Efficiency/Renewables", and an exact match reads the second as a
  // stranger — leaving the box unticked for a contact who plainly has the
  // tag, and the tag itself sitting in the free-text extras.
  const knownTagKeys = new Set(visibleTagOptions.map(tagKey));

  const cid = contact.id || contact.vid;
  const savedNote = (cid && contactNotes[cid]) || contact.notes || contact.hs_content_membership_notes || contact.message || '';
  const savedOldEmails = (cid && contactOldEmails[cid]) || '';
  const savedOldCompany = (cid && contactOldCompany[cid]) || '';
  const savedNickname = (cid && contactNicknames[cid]) || '';
  const savedTeamName = (cid && contactTeamNames[cid]) || '';
  const savedFamily = (cid && contactFamilies[cid]) || { partner: '', kids: '' };

  // Prevent Backspace from triggering browser back-navigation (Firefox / older Edge behaviour)
  // when focus is outside a text field. This otherwise unmounts the modal.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Backspace') return;
      const t = e.target;
      if (!t) return;
      const tag = (t.tagName || '').toLowerCase();
      const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
      if (!isEditable) e.preventDefault();
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const [f, setF] = useState({
    firstname: contact.firstname || '',
    lastname: contact.lastname || '',
    email: contact.email || '',
    phone: contact.phone || '',
    mobilephone: contact.mobilephone || contact.mobile_phone || '',
    jobtitle: contact.jobtitle || '',
    company: contact.company || '',
    hs_linkedin_url: contact.hs_linkedin_url || contact.linkedin_url || '',
    city: contact.city || '',
    state: contact.state || '',
    country: contact.country || '',
    nickname: savedNickname,
    teamName: savedTeamName,
    notes: savedNote,
    oldEmails: savedOldEmails,
    oldCompany: savedOldCompany,
    partner: savedFamily.partner || '',
    kids: savedFamily.kids || '',
  });
  // Checked state for the 5 known tags
  const [checkedTags, setCheckedTags] = useState(() =>
    new Set(parsedTags.filter(t => knownTagKeys.has(tagKey(t))).map(t => {
      // Normalise to the option's own spelling, so saving converges the
      // duplicates rather than preserving both — the same rewrite the API
      // performs when HubSpot refuses a spelling it already holds under
      // another (see reconcileDansTags).
      return visibleTagOptions.find(o => tagKey(o) === tagKey(t)) || t;
    }))
  );
  // "Met In Person" is its own checkbox, stored locally (never in HubSpot).
  // Prefer the saved local value; for contacts that haven't been touched
  // yet, fall back to the legacy HubSpot tag so anyone already tagged shows
  // up checked.
  const metCid = contact.id || contact.vid;
  const [metInPerson, setMetInPerson] = useState(() => {
    const stored = metCid != null ? contactMetInPerson[metCid] : undefined;
    if (stored !== undefined) return !!stored;
    return parsedTags.some(t => t.toLowerCase() === metLower);
  });
  // "Invited to Louisville" — another local-only flag (never in HubSpot).
  const [invitedToLouisville, setInvitedToLouisville] = useState(() =>
    metCid != null ? !!contactInvitedToLouisville[metCid] : false
  );
  // Champion / neutral / detractor — local-only as well, and the thing the
  // Divisions chart marks people with. Neutral is the stored absence, so a
  // contact nobody has judged starts here and leaves no key behind.
  const [sentiment, setSentiment] = useState(() => sentimentFor(contactSentiment, metCid));
  // Per-tag records: { tag: { answer, status } }. The tag itself is still
  // where a Yes lives, so a stored answer of "yes" only counts while it's
  // backed by the tag or held off by a Not sold — see tagStateFrom.
  const [tagVerdicts, setTagVerdicts] = useState(() =>
    (metCid != null && contactTagReview[metCid] && typeof contactTagReview[metCid] === 'object')
      ? { ...contactTagReview[metCid] }
      : {}
  );
  // Both bits of tag state above are seeded once, from the contact this
  // popup opened with. Re-seed them whenever the saved values change
  // underneath it — a mass edit applied to this same contact while the
  // popup is open, a HubSpot sync, a change made on another device — so
  // the header's Tagged % can't drift away from the figure the contacts
  // table shows, which is read from those same saved values.
  //
  // Neither effect fires on an edit made HERE: a click writes the tag to
  // HubSpot and the record to settings, and the props only come back
  // holding what was just written. The optimistic state a click leaves
  // behind is therefore safe until the write lands (or is rolled back by
  // persistDansTags below when HubSpot refuses it).
  //
  // Keyed on tagKey, not on case alone. A tag whose spelling the vocabulary
  // doesn't hold exactly — "Efficiency/Renewables" against the list's
  // "Efficiency / Renewables" — has to resolve to the option it IS, or this
  // drops it: the row reads as untagged however plainly HubSpot has it, and
  // the next save from this popup writes the tag list without it.
  useEffect(() => {
    const canonical = new Map(
      tagOptions
        .filter(t => t.toLowerCase() !== MET_IN_PERSON_TAG.toLowerCase())
        .map(t => [tagKey(t), t]),
    );
    setCheckedTags(new Set(
      rawTags.split(';').map(t => t.trim()).filter(Boolean)
        .map(t => canonical.get(tagKey(t)))
        .filter(Boolean),
    ));
  }, [rawTags, tagOptions]);
  const savedTagReview = metCid != null ? contactTagReview[metCid] : undefined;
  useEffect(() => {
    setTagVerdicts(savedTagReview && typeof savedTagReview === 'object' ? { ...savedTagReview } : {});
  }, [savedTagReview]);

  // Any extra tags not in TAG_OPTIONS are kept verbatim (excluding the
  // met-in-person flag, which is reattached from its checkbox on save).
  const extraTags = parsedTags.filter(t => !knownTagKeys.has(tagKey(t)) && t.toLowerCase() !== metLower);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);

  async function copyEmail() {
    const e = (f.email || '').trim();
    if (!e) return;
    try {
      await navigator.clipboard?.writeText(e);
    } catch {
      return;
    }
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 1500);
  }
  // Merge state. When `mergeOpen` is true, we show an inline picker
  // letting the user choose a second contact to merge INTO this one.
  // The current contact is always the primary (kept), the picked one
  // is the secondary (consumed and removed by HubSpot's merge API).
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeProcessing, setMergeProcessing] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [deleting, setDeleting] = useState(false);
  async function performDelete() {
    const targetId = contact.id || contact.vid;
    if (!targetId) return;
    const name = `${f.firstname} ${f.lastname}`.trim() || f.email || 'this contact';
    if (!window.confirm(`Delete ${name}? This permanently removes the contact from HubSpot. This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      const isLocalOnly = typeof targetId === 'string' && targetId.startsWith('local-');
      // Local-only contacts were never pushed to HubSpot — just drop them
      // from the cache. Everyone else goes through the HubSpot delete API.
      if (!isLocalOnly) {
        const res = await apiFetch('/api/hubspot?action=delete-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: targetId }),
        });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || `HubSpot ${res.status}`);
      }
      // Remove from the local cache so the contact disappears immediately.
      try {
        await updateHubspotCache(draft => {
          draft.contacts = (draft.contacts || []).filter(c => String(c.id || c.vid) !== String(targetId));
        });
      } catch (err) { console.warn('Delete cache update failed', err); }
      onClose();
    } catch (err) {
      setError(err?.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }
  async function performMerge(secondaryId, secondaryLabel) {
    const primaryId = contact.id || contact.vid;
    if (!primaryId || !secondaryId || String(primaryId) === String(secondaryId)) return;
    if (!window.confirm(`Merge "${secondaryLabel}" into this contact? The other contact will be DELETED in HubSpot: its email history, notes, and engagements move into the kept contact. This cannot be undone.`)) return;
    setMergeProcessing(true);
    setMergeError('');
    try {
      const res = await apiFetch('/api/hubspot?action=merge-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryObjectId: primaryId, objectIdToMerge: secondaryId }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HubSpot ${res.status}`);
      // Drop the secondary from the local cache so it disappears
      // immediately. The primary's properties may shift slightly post
      // -merge (HubSpot inherits fields from the secondary if blank
      // on the primary); a periodic full-sync picks those up.
      try {
        await updateHubspotCache(draft => {
          draft.contacts = (draft.contacts || []).filter(c => String(c.id || c.vid) !== String(secondaryId));
        });
      } catch (err) { console.warn('Merge cache update failed', err); }
      setMergeOpen(false);
      setMergeQuery('');
      onClose();
    } catch (err) {
      setMergeError(err?.message || 'Merge failed');
    } finally {
      setMergeProcessing(false);
    }
  }
  // City autocomplete (alias-aware) — typing "NYC" surfaces "New York
  // City" and selecting writes the canonical name. Free-typed values
  // are still allowed; the dropdown closes on commit.
  const [cityOpen, setCityOpen] = useState(false);
  const [cityHover, setCityHover] = useState(0);
  const cityBoxRef = useRef(null);
  useEffect(() => {
    if (!cityOpen) return;
    const onDown = (e) => { if (!cityBoxRef.current?.contains(e.target)) setCityOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [cityOpen]);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [companyHover, setCompanyHover] = useState(0);
  const companyBoxRef = useRef(null);
  useEffect(() => {
    if (!companyOpen) return;
    const onDown = (e) => { if (!companyBoxRef.current?.contains(e.target)) setCompanyOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [companyOpen]);
  const [error, setError] = useState(null);
  // Surfaced after a save when the Company edit was kept as a local
  // override because HubSpot linked the contact to a differently-named
  // Company record (or couldn't pin the association). Mirrors the note
  // the HubSpot Contacts page shows.
  const [companyNote, setCompanyNote] = useState('');
  const [tagsOpen, setTagsOpen] = useState(false);
  const tagsRef = useRef(null);

  // CC / To-Also state. The maps are keyed by the contact's PRIMARY
  // email — when this contact's email gets sent a draft, anyone in
  // ccEmails is auto-CC'd and anyone in toAlsoEmails is added to the
  // To line alongside the primary. Mirrors the HubSpot Contacts page's
  // ContactModal so editors on either page produce identical results.
  const [ccEmails, setCcEmails] = useState(() => {
    const e = (contact?.email || '').trim();
    if (!e) return [];
    return Array.isArray(ccMap?.[e]) ? ccMap[e] : [];
  });
  const [ccInput, setCcInput] = useState('');
  const [showCcSuggestions, setShowCcSuggestions] = useState(false);
  const ccBoxRef = useRef(null);
  const [toAlsoEmails, setToAlsoEmails] = useState(() => {
    const e = (contact?.email || '').trim();
    if (!e) return [];
    return Array.isArray(toAlsoMap?.[e]) ? toAlsoMap[e] : [];
  });
  const [toAlsoInput, setToAlsoInput] = useState('');
  const [showToAlsoSuggestions, setShowToAlsoSuggestions] = useState(false);
  const toAlsoBoxRef = useRef(null);
  // Pool of every HubSpot contact with an email — used as the
  // suggestion source for the CC / To Also pickers. Loaded once on
  // mount, refreshed on hubspot-cache-updated so a contact added
  // while the popup is open shows up in the dropdown.
  const [allEmails, setAllEmails] = useState([]);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getHubspotCache().then(cache => {
        if (cancelled) return;
        const list = (cache?.contacts || []).filter(c => c.email).map(c => ({
          email: c.email,
          name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email,
        }));
        setAllEmails(list);
      }).catch(() => {});
    }
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);
  useEffect(() => {
    if (!showCcSuggestions) return;
    const h = e => { if (ccBoxRef.current && !ccBoxRef.current.contains(e.target)) setShowCcSuggestions(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showCcSuggestions]);
  useEffect(() => {
    if (!showToAlsoSuggestions) return;
    const h = e => { if (toAlsoBoxRef.current && !toAlsoBoxRef.current.contains(e.target)) setShowToAlsoSuggestions(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showToAlsoSuggestions]);

  function addCc(email) {
    const t = String(email || '').trim();
    if (!t || ccEmails.includes(t)) return;
    setCcEmails([...ccEmails, t]);
    setCcInput('');
    setShowCcSuggestions(false);
  }
  function removeCc(email) {
    setCcEmails(ccEmails.filter(e => e !== email));
  }
  function addToAlso(email) {
    const t = String(email || '').trim();
    if (!t || toAlsoEmails.includes(t)) return;
    setToAlsoEmails([...toAlsoEmails, t]);
    setToAlsoInput('');
    setShowToAlsoSuggestions(false);
  }
  function removeToAlso(email) {
    setToAlsoEmails(toAlsoEmails.filter(e => e !== email));
  }
  const ccSuggestions = ccInput.trim()
    ? allEmails.filter(c => !ccEmails.includes(c.email) && c.email !== (contact?.email || '') && (c.email.toLowerCase().includes(ccInput.toLowerCase()) || c.name.toLowerCase().includes(ccInput.toLowerCase()))).slice(0, 6)
    : [];
  const toAlsoSuggestions = toAlsoInput.trim()
    ? allEmails.filter(c => !toAlsoEmails.includes(c.email) && c.email !== (contact?.email || '') && (c.email.toLowerCase().includes(toAlsoInput.toLowerCase()) || c.name.toLowerCase().includes(toAlsoInput.toLowerCase()))).slice(0, 6)
    : [];

  useEffect(() => {
    if (!tagsOpen) return;
    // Close only when the click is truly outside the picker. Use capture phase + closest()
    // so the check runs before any re-render can remove the clicked element from the DOM.
    const h = e => {
      const t = e.target;
      if (!t) return;
      if (tagsRef.current && tagsRef.current.contains(t)) return;
      if (typeof t.closest === 'function' && t.closest('[data-tags-picker]')) return;
      setTagsOpen(false);
    };
    document.addEventListener('mousedown', h, true);
    return () => document.removeEventListener('mousedown', h, true);
  }, [tagsOpen]);

  const [tagsSaveStatus, setTagsSaveStatus] = useState('');
  // '' | 'loading' | 'auto' | 'none' — drives the small label next to
  // the City field while a Nominatim lookup is in flight or after it
  // resolves. Reset whenever the user edits city/state manually.
  const [cityLookupStatus, setCityLookupStatus] = useState('');

  // "Met In Person" is intentionally NOT included here — it's a local-only
  // checkbox and HubSpot rejects it as a dans_tags value.
  function buildTagsStringFrom(set) {
    return [...set, ...extraTags].join(';');
  }

  // Returns true when HubSpot took the tags, false when it refused them —
  // the caller uses that to undo the checkbox it flipped optimistically.
  async function persistDansTags(tagsStr) {
    const cid = contact.id || contact.vid;
    if (!cid) return true; // new contact — save will include tags on create
    setTagsSaveStatus('Saving tag…');
    try {
      const res = await apiFetch(`/api/hubspot?action=update-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: cid, properties: { dans_tags: tagsStr } }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json?.message || json?.error || `HubSpot ${res.status}`);
      // Update local cache so the main view reflects the change immediately
      try {
        await updateHubspotCache(draft => {
          const idx = draft.contacts.findIndex(c => String(c.id || c.vid) === String(cid));
          if (idx !== -1) draft.contacts[idx] = { ...draft.contacts[idx], dans_tags: tagsStr };
        });
      } catch {}
      onSave({ ...contact, dans_tags: tagsStr }, { silent: true });
      setTagsSaveStatus('Saved ✓');
      setTimeout(() => setTagsSaveStatus(''), 1500);
      return true;
    } catch (err) {
      console.error('[ContactEditModal] Tag autosave failed:', err);
      setTagsSaveStatus('Save failed: ' + (err?.message || err));
      setTimeout(() => setTagsSaveStatus(''), 4000);
      return false;
    }
  }

  // This tag's saved record, whatever spelling it was stored under. The bulk
  // tag editor writes HubSpot's spelling of a tag while this table is keyed
  // on the vocabulary's, and the two differ by more than case in this
  // dataset — "Efficiency/Renewables" against "Efficiency / Renewables" — so
  // matching on anything narrower than tagKey reads an answered tag as a
  // blank row.
  function verdictFor(tag) {
    return findTagRecord(tagVerdicts, tag);
  }

  // Set one half of a tag's record — the answer (Yes / No / Not sure) or the
  // sale status (Sold / Not sold). The two are independent, so setting one
  // leaves the other alone: a contact can be Yes and Not sold at once, which
  // is the case a single answer couldn't say.
  //
  // The HubSpot tag follows from both. Yes puts it on, Sold puts it on, and
  // Not sold overrides either and takes it off — that hold-off is the whole
  // mechanism for keeping someone out of a general pull of the tag until
  // their account buys. Everything else is local, because an absent tag
  // means "doesn't apply", "haven't looked", "don't know" and "holding off"
  // all at once. Clicking the current choice again clears that half.
  function updateTagRecord(tag, apply) {
    // Built from the resolved state rather than the raw record, so a value
    // the tag has since contradicted can't leak back in through an edit.
    const current = tagStateFrom(checkedTags.has(tag), verdictFor(tag));
    const next = apply(current);
    const shouldBeTagged = recordKeepsTag(next);
    if (shouldBeTagged !== checkedTags.has(tag)) {
      const set = new Set(checkedTags);
      if (shouldBeTagged) set.add(tag); else set.delete(tag);
      setCheckedTags(set);
      // The tag is shown on (or off) before HubSpot has agreed, so the row
      // answers instantly. If HubSpot refuses the write, put it back: a tag
      // this popup believes in but the saved record doesn't have is exactly
      // how the header's Tagged % ends up ahead of the table's, which reads
      // the saved record. The failure is already on screen next to the Tags
      // label; this stops the count claiming the write landed.
      persistDansTags(buildTagsStringFrom(set)).then(ok => {
        if (ok) return;
        setCheckedTags(prev => {
          const back = new Set(prev);
          if (shouldBeTagged) back.delete(tag); else back.add(tag);
          return back;
        });
      });
    }
    setTagVerdicts(prev => {
      const map = { ...prev };
      // Drop any record saved under another spelling of this tag, so an edit
      // replaces it rather than leaving two records for the one tag.
      const k = tagKey(tag);
      for (const key of Object.keys(map)) if (key !== tag && tagKey(key) === k) delete map[key];
      if (next.answer || next.status) map[tag] = { answer: next.answer, status: next.status };
      else delete map[tag];
      const cid = contact.id || contact.vid;
      if (cid != null && onSaveTagReview) onSaveTagReview(cid, map);
      return map;
    });
  }

  function setTagAnswer(tag, answer) {
    updateTagRecord(tag, (cur) => withTagAnswer(cur, cur.answer === answer ? '' : answer));
  }

  function setTagStatus(tag, status) {
    updateTagRecord(tag, (cur) => withTagStatus(cur, cur.status === status ? '' : status));
  }

  function toggleMetInPerson() {
    setMetInPerson(prev => {
      const next = !prev;
      // Local-only — persisted to Firestore settings, never pushed to HubSpot.
      const cid = contact.id || contact.vid;
      if (cid != null && onSaveMetInPerson) onSaveMetInPerson(cid, next);
      return next;
    });
  }

  function toggleInvitedToLouisville() {
    setInvitedToLouisville(prev => {
      const next = !prev;
      const cid = contact.id || contact.vid;
      if (cid != null && onSaveInvitedToLouisville) onSaveInvitedToLouisville(cid, next);
      return next;
    });
  }

  // Clicking the choice a contact already has clears it back to neutral, so
  // the picker can undo itself without a fourth button.
  function chooseSentiment(value) {
    setSentiment(prev => {
      const next = prev === value ? '' : value;
      const cid = contact.id || contact.vid;
      if (cid != null && onSaveSentiment) onSaveSentiment(cid, next);
      return next;
    });
  }

  function set(key, val) { setF(prev => ({ ...prev, [key]: val })); }

  // Autosave fires from a debounce timer (and from the unmount flush), so it
  // can't read the render-time closure — by the time it runs the user has
  // usually typed more. Keep the editable state on a ref that every render
  // refreshes and have handleSave read from that instead.
  const stateRef = useRef(null);
  stateRef.current = { f, checkedTags, ccEmails, toAlsoEmails, metInPerson, invitedToLouisville, sentiment };

  // `auto` marks a background (debounced) save: the modal stays open and any
  // status is reported inline rather than by handing control back to the
  // caller, which closes the popup on a non-silent onSave.
  async function handleSave({ auto = false } = {}) {
    const snap = stateRef.current;
    // An explicit click means the user is done typing, so the Company field's
    // current text counts as committed even if it never lost focus.
    if (!auto) companyCommittedRef.current = snap.f.company;
    setSaving(true);
    setError(null);
    setCompanyNote('');
    try {
      const allProps = { ...snap.f, company: companyCommittedRef.current, dans_tags: buildTagsStringFrom(snap.checkedTags) };
      // HubSpot doesn't have these local-only fields — save them separately via settings.
      const { notes, oldEmails, oldCompany, nickname, teamName, partner, kids, ...hsProps } = allProps;
      const noteValue = notes || '';
      const oldEmailsValue = oldEmails || '';
      const oldCompanyValue = oldCompany || '';
      const nicknameValue = nickname || '';
      const teamNameValue = teamName || '';
      const familyValue = { partner: partner || '', kids: kids || '' };
      const existingId = contact.id || contact.vid;
      const isLocalOnly = typeof existingId === 'string' && existingId.startsWith('local-');
      let isNew = !existingId || isLocalOnly;
      let action = isNew ? 'create-contact' : 'update-contact';
      let body = isNew
        ? { properties: hsProps }
        : { contactId: contact.id || contact.vid, properties: hsProps };
      let res = await apiFetch(`/api/hubspot?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let json = await res.json();
      // If create failed because the contact already exists, retry as an update using the existing HubSpot id
      if (isNew && !res.ok) {
        const msg = json?.message || json?.error || '';
        const existingIdMatch = String(msg).match(/Existing ID[:\s]+(\d+)/i);
        if (existingIdMatch) {
          const dupId = existingIdMatch[1];
          action = 'update-contact';
          body = { contactId: dupId, properties: hsProps };
          res = await apiFetch(`/api/hubspot?action=${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          json = await res.json();
          if (res.ok) {
            isNew = false;
            contact.id = dupId; // so downstream savedContact carries it
          }
        }
      }
      if (!res.ok || json.error) throw new Error(json?.message || json?.error || `HubSpot ${res.status}`);
      // Include notes in the saved contact (stored locally). create-contact
      // returns the new record under json.contact (id + properties), not a
      // top-level json.id — reading json.id left new contacts with an
      // undefined id, so they never got a companyContactLinks pin and their
      // per-contact metadata (notes/team/etc.) saved under an empty key.
      const newId = json?.contact?.id ?? json?.id;
      // create-contact recovers from a duplicate-email collision by returning
      // the existing HubSpot contact (HTTP 200 + alreadyExisted) instead of
      // forging a second record. Recognize that so we attach/link the existing
      // contact rather than minting a phantom "Manual" row that shares the real
      // contact's id (which a later delete-by-id would then wipe alongside it).
      const alreadyExisted = isNew && json?.alreadyExisted === true && !!newId;
      const savedContact = isNew ? { id: newId, ...allProps } : { ...contact, ...allProps };
      // Update HubSpot cache (exclude notes/oldEmails — those live in Firestore settings)
      try {
        await updateHubspotCache(draft => {
          const cacheProps = { ...hsProps };
          if (isNew && alreadyExisted) {
            // The contact already lived in HubSpot — the server handed back the
            // existing record. Don't stamp a phantom _source:'manual' duplicate
            // (it shares the real record's id, so deleting it later would take
            // the real one with it), and don't overwrite the richer existing
            // fields with this often-sparse form. Just make sure the real record
            // is present so linking it to this company (via onSave below)
            // surfaces it; leave its _source and fields untouched if it's there.
            const exists = draft.contacts.some(c => String(c.id || c.vid) === String(savedContact.id));
            if (!exists) draft.contacts.push({ id: savedContact.id, ...cacheProps });
          } else if (isNew) {
            // If this was promoted from a local-only contact, remove the old local entry so we don't duplicate
            if (isLocalOnly && existingId) {
              draft.contacts = draft.contacts.filter(c => String(c.id || c.vid) !== String(existingId));
            }
            draft.contacts.push({ id: savedContact.id, ...cacheProps, _source: 'manual' });
          } else {
            const idx = draft.contacts.findIndex(c => String(c.id || c.vid) === String(contact.id || contact.vid));
            if (idx !== -1) draft.contacts[idx] = { ...draft.contacts[idx], ...cacheProps };
          }
        });
      } catch (err) {
        console.warn('HubSpot cache write failed:', err?.message || err);
      }
      // Save note & old emails to Firestore settings (cross-device)
      const savedCid = savedContact.id || savedContact.vid;
      if (savedCid && onSaveNote) {
        onSaveNote(savedCid, noteValue);
      }
      if (savedCid && onSaveOldEmails) {
        onSaveOldEmails(savedCid, oldEmailsValue);
      }
      if (savedCid && onSaveOldCompany) {
        onSaveOldCompany(savedCid, oldCompanyValue);
      }
      if (savedCid && onSaveNickname) {
        onSaveNickname(savedCid, nicknameValue);
      }
      if (savedCid && onSaveTeamName) {
        onSaveTeamName(savedCid, teamNameValue);
      }
      if (savedCid && onSaveFamily) {
        onSaveFamily(savedCid, familyValue);
      }
      if (savedCid && onSaveMetInPerson) {
        onSaveMetInPerson(savedCid, snap.metInPerson);
      }
      if (savedCid && onSaveInvitedToLouisville) {
        onSaveInvitedToLouisville(savedCid, snap.invitedToLouisville);
      }
      // A contact created here has no id until HubSpot hands one back, so the
      // click-time save above was a no-op — persist it under the real id now.
      if (savedCid && onSaveSentiment) {
        onSaveSentiment(savedCid, snap.sentiment);
      }
      // Company edits behave the same here as on the HubSpot Contacts
      // page: the API renames the Company record this contact is linked to,
      // so the new name lands in HubSpot and cascades to every contact at
      // that company. If the rename fails (or the contact had no company and
      // HubSpot linked it to a differently-named record), keep the typed
      // value as a local _companyOverride; otherwise clear any stale
      // override now that HubSpot holds the name.
      if (savedCid && onSaveCompanyOverride && typeof hsProps.company === 'string') {
        const ca = json.companyAssignment;
        // Always pin the typed value locally so it survives a refresh
        // regardless of HubSpot sync/association timing; the API also renamed
        // the linked Company record, so the pin stays consistent with HubSpot.
        // (Empty string → clear the override instead.)
        onSaveCompanyOverride(savedCid, hsProps.company || null);
        if (ca && ca.ok === false) {
          const what = ca.mode === 'rename-failed' ? 'rename the Company record' : 'pin the Company association';
          setCompanyNote(`Saved "${hsProps.company}" locally. HubSpot couldn't ${what}${hubspotFailureDetail(ca)} Prospect Tracker will keep your value through future syncs.`);
        } else if (ca && ca.ok === true) {
          if (ca.mode === 'renamed') {
            setCompanyNote(`Renamed the HubSpot Company "${ca.oldName || '-'}" → "${hsProps.company}". This updates it for every contact linked to that company.`);
          } else if (ca.nameDiffers && ca.matchedName) {
            setCompanyNote(`Saved "${hsProps.company}". This contact had no linked company, so HubSpot linked it to an existing record named "${ca.matchedName}".`);
          }
        }
      }
      // Persist CC / To Also maps keyed by the contact's primary
      // email — Draft Emails reads these on every campaign preview to
      // auto-add the linked recipients.
      const primaryEmail = (savedContact.email || '').trim();
      if (primaryEmail && onSaveCcMap) {
        const next = { ...(ccMap || {}) };
        if (snap.ccEmails.length > 0) next[primaryEmail] = snap.ccEmails;
        else delete next[primaryEmail];
        onSaveCcMap(next);
      }
      if (primaryEmail && onSaveToAlsoMap) {
        const next = { ...(toAlsoMap || {}) };
        if (snap.toAlsoEmails.length > 0) next[primaryEmail] = snap.toAlsoEmails;
        else delete next[primaryEmail];
        onSaveToAlsoMap(next);
      }
      // Mark exactly what went to HubSpot as clean, so edits made *during*
      // the request still register as unsaved and get their own pass.
      savedSigRef.current = signatureOf(snap);
      failedSigRef.current = null;
      setSavedSig(savedSigRef.current);
      // A non-silent onSave hands control back to the caller, which closes the
      // popup — right for an explicit "Save now", wrong for a background save.
      onSave(savedContact, auto ? { silent: true } : undefined);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      failedSigRef.current = signatureOf(snap);
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------
  // Autosave. Editing an existing HubSpot contact writes back on its own a
  // beat after typing stops — the Save button stays as a "save it right now"
  // escape hatch and a status readout. New contacts are excluded: an
  // unfinished form shouldn't mint a HubSpot record, so those still go
  // through the explicit "Create in HubSpot" click.
  //
  // Tags, Met In Person, Invited to Louisville, Champion/Detractor, Reports To
  // and Events already persist the moment they're toggled, so the signature below only covers the
  // fields that used to need the button: the text inputs plus CC / To Also.
  const AUTOSAVE_DELAY_MS = 900;
  // The Company field is special: saving it renames the linked HubSpot Company
  // record, which cascades to every contact there. Autosaving on each keystroke
  // would rename it to "Acm" on the way to "Acme", so the field only counts as
  // edited once it's committed — blurred, picked from the list, or pushed by an
  // explicit Save click. A ref (not state) because the commit often lands in the
  // same batch as the close that unmounts us.
  const companyCommittedRef = useRef(contact.company || '');
  const [, setCompanyCommittedTick] = useState(0);
  function commitCompany(value) {
    if (companyCommittedRef.current === value) return;
    companyCommittedRef.current = value;
    setCompanyCommittedTick(n => n + 1); // re-run the dirty check with the new value
  }
  // Tags are deliberately absent: persistDansTags already pushes them on
  // toggle, so counting them here would fire a second, identical write.
  // Company comes from the committed value, not the raw field — see below.
  function signatureOf(snap) {
    return JSON.stringify({
      f: { ...snap.f, company: companyCommittedRef.current },
      cc: snap.ccEmails,
      toAlso: snap.toAlsoEmails,
    });
  }
  const existingHsId = contact.id || contact.vid;
  const autosaveEnabled = !!existingHsId && !(typeof existingHsId === 'string' && existingHsId.startsWith('local-'));
  const currentSig = signatureOf(stateRef.current);
  const [savedSig, setSavedSig] = useState(currentSig);
  const savedSigRef = useRef(currentSig);
  // Signature of the payload whose save failed — retrying it on a timer would
  // just hammer a broken request, so we wait for the next edit (or a click).
  const failedSigRef = useRef(null);
  const inFlightRef = useRef(null);
  const dirty = currentSig !== savedSig;
  // Saving a half-typed address would push "dan@" to HubSpot (and key the
  // CC / To Also maps off it) before the next keystroke fixes it, so hold the
  // autosave until the address is at least shaped like one. The explicit
  // button is unaffected — it only needs a non-empty value, as before.
  const emailLooksComplete = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((f.email || '').trim());
  const canAutosave = autosaveEnabled && dirty && emailLooksComplete && failedSigRef.current !== currentSig;

  function runSave(opts) {
    const p = handleSave(opts);
    inFlightRef.current = p;
    return p;
  }

  useEffect(() => {
    if (!canAutosave || saving) return;
    const t = setTimeout(() => { void runSave({ auto: true }); }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSig, savedSig, saving, canAutosave]);

  // Closing the popup (backdrop, ×, Close, Esc) unmounts us mid-debounce, so
  // flush whatever is still pending. If a save is already in flight the flush
  // waits for it and re-checks — stateRef is frozen at that point, so the
  // comparison against the last persisted signature is still accurate.
  const flushRef = useRef(null);
  flushRef.current = () => {
    if (!autosaveEnabled) return;
    const flush = () => {
      const sig = signatureOf(stateRef.current);
      if (sig === savedSigRef.current) return;
      if (!stateRef.current.f.email.trim()) return;
      if (failedSigRef.current === sig) return;
      void handleSave({ auto: true });
    };
    if (inFlightRef.current) inFlightRef.current.then(flush, flush);
    else flush();
  };
  useEffect(() => () => flushRef.current?.(), []);

  const inputStyle = { width: '100%', padding: '0.35rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '6px', fontSize: '0.78rem', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' };
  const labelStyle = { fontSize: '0.65rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '3px' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={e => { e.stopPropagation(); onClose(); }}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', width: '880px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>{(!contact.id && !contact.vid) ? 'New HubSpot Contact' : 'Edit HubSpot Contact'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', padding: '0.45rem 0.7rem', border: `1px solid ${metInPerson ? '#7DD3FC' : '#E2E8F0'}`, borderRadius: '8px', background: metInPerson ? '#F0F9FF' : '#fff' }}>
            <input
              type="checkbox"
              checked={metInPerson}
              onChange={toggleMetInPerson}
              style={{ accentColor: '#0078D4', width: '16px', height: '16px', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: metInPerson ? '#0369A1' : '#374151' }}>Met In Person</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', padding: '0.45rem 0.7rem', border: `1px solid ${invitedToLouisville ? '#7DD3FC' : '#E2E8F0'}`, borderRadius: '8px', background: invitedToLouisville ? '#F0F9FF' : '#fff' }}>
            <input
              type="checkbox"
              checked={invitedToLouisville}
              onChange={toggleInvitedToLouisville}
              style={{ accentColor: '#0078D4', width: '16px', height: '16px', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: invitedToLouisville ? '#0369A1' : '#374151' }}>Invited to Louisville</span>
          </label>
          {/* Where this person stands on us. The chosen button carries the
              same mark the Divisions chart draws, so the two read as one
              setting rather than a field and an unexplained icon. */}
          <div
            role="group"
            aria-label="Standing"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '8px', background: '#fff' }}
          >
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Standing</span>
            <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
              {SENTIMENT_OPTIONS.map(opt => {
                const on = sentiment === opt.value;
                const mark = sentimentMark(opt.value);
                return (
                  <button
                    key={opt.value || 'neutral'}
                    type="button"
                    onClick={() => chooseSentiment(opt.value)}
                    aria-pressed={on}
                    title={opt.value
                      ? `Mark ${opt.label.toLowerCase()} — shows on the Divisions chart`
                      : 'No mark on the Divisions chart'}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                      padding: '0.22rem 0.55rem', borderRadius: '999px', cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 600,
                      border: `1px solid ${on ? (mark?.color || '#94A3B8') : '#E2E8F0'}`,
                      background: on ? (mark ? `${mark.color}14` : '#F1F5F9') : '#fff',
                      color: on ? (mark?.color || '#334155') : '#64748B',
                    }}
                  >
                    {mark && <span aria-hidden="true">{mark.symbol}</span>}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
          <div><label style={labelStyle}>First Name</label><input style={inputStyle} value={f.firstname} onChange={e => set('firstname', e.target.value)} /></div>
          <div><label style={labelStyle}>Last Name</label><input style={inputStyle} value={f.lastname} onChange={e => set('lastname', e.target.value)} /></div>
          <div>
            <label style={labelStyle}>Full Name <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(auto)</span></label>
            <input
              style={{ ...inputStyle, background: '#F8FAFC', color: '#64748B' }}
              value={`${f.firstname || ''} ${f.lastname || ''}`.trim()}
              readOnly
              placeholder="-"
            />
          </div>
          <div><label style={labelStyle}>Work Phone Number</label><input style={inputStyle} value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
          <div><label style={labelStyle}>Cell Phone Number</label><input style={inputStyle} value={f.mobilephone} onChange={e => set('mobilephone', e.target.value)} /></div>
          <div><label style={labelStyle}>Goes By <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(opt.)</span></label><input style={inputStyle} value={f.nickname} onChange={e => set('nickname', e.target.value)} placeholder="e.g. Bob" /></div>
          <div><label style={labelStyle}>Team Name <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(opt.)</span></label><input style={inputStyle} value={f.teamName} onChange={e => set('teamName', e.target.value)} placeholder="e.g. FP&A" /></div>
          <div><label style={labelStyle}>Partner&apos;s name <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(opt.)</span></label><input style={inputStyle} value={f.partner} onChange={e => set('partner', e.target.value)} placeholder="e.g. Jane" /></div>
          <div><label style={labelStyle}>Kids&apos; names <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(opt.)</span></label><input style={inputStyle} value={f.kids} onChange={e => set('kids', e.target.value)} placeholder="e.g. Sam (12), Riley (9)" /></div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={labelStyle}>Email <span style={{ fontWeight: 400, textTransform: 'none', color: '#DC2626' }}>*</span></label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input style={{ ...inputStyle, flex: 1 }} type="email" value={f.email} onChange={e => set('email', e.target.value)} />
              <button
                type="button"
                onClick={copyEmail}
                disabled={!f.email}
                style={{ padding: '0.3rem 0.55rem', border: '1px solid #BFDBFE', borderRadius: 4, background: emailCopied ? '#DCFCE7' : '#EFF6FF', color: emailCopied ? '#166534' : '#1E40AF', fontSize: '0.68rem', fontWeight: 600, cursor: f.email ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >{emailCopied ? 'Copied!' : 'Copy'}</button>
            </div>
            {(() => {
              const isNewContact = !contact.id && !contact.vid;
              if (!isNewContact) return null;
              const first = (f.firstname || '').toLowerCase().trim().replace(/[^a-z]/g, '');
              const last = (f.lastname || '').toLowerCase().trim().replace(/[^a-z]/g, '');
              if (!first && !last) return null;
              const domains = (emailDomains || []).filter(Boolean);
              if (domains.length === 0) return null;
              const suggestions = [];
              for (const d of domains) {
                let domain = d.replace(/^@/, '').trim();
                // If a full email was provided, extract only the domain part
                if (domain.includes('@')) domain = domain.split('@').pop();
                if (!domain || !domain.includes('.')) continue;
                if (first && last) {
                  suggestions.push(`${first}.${last}@${domain}`);
                  suggestions.push(`${first}${last}@${domain}`);
                  suggestions.push(`${first[0]}${last}@${domain}`);
                }
                if (first) suggestions.push(`${first}@${domain}`);
              }
              const unique = [...new Set(suggestions)];
              if (unique.length === 0) return null;
              return (
                <div style={{ marginTop: '0.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  <span style={{ fontSize: '0.65rem', color: '#64748B', alignSelf: 'center' }}>Suggest:</span>
                  {unique.map(s => (
                    <button key={s} type="button" onClick={() => set('email', s)} style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem', border: '1px solid #BFDBFE', borderRadius: '999px', background: '#EFF6FF', color: '#1E40AF', cursor: 'pointer', fontFamily: 'inherit' }}>{s}</button>
                  ))}
                </div>
              );
            })()}
          </div>
          <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Job Title</label><input style={inputStyle} value={f.jobtitle} onChange={e => set('jobtitle', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 2', position: 'relative' }} ref={companyBoxRef}>
            <label style={labelStyle}>Company</label>
            {(() => {
              const q = (f.company || '').trim().toLowerCase();
              const seen = new Set();
              const all = [];
              for (const n of (companyNames || [])) {
                const s = String(n || '').trim();
                if (!s) continue;
                const k = s.toLowerCase();
                if (seen.has(k)) continue;
                seen.add(k);
                all.push(s);
              }
              const matches = q
                ? all.filter(n => n.toLowerCase().includes(q)).slice(0, 12)
                : all.slice(0, 12);
              const showList = companyOpen && matches.length > 0;
              return (
                <>
                  <input
                    style={inputStyle}
                    value={f.company}
                    onFocus={() => { setCompanyOpen(true); setCompanyHover(0); }}
                    onChange={e => { set('company', e.target.value); setCompanyOpen(true); setCompanyHover(0); }}
                    onBlur={e => commitCompany(e.target.value)}
                    onKeyDown={e => {
                      if (!showList) return;
                      if (e.key === 'ArrowDown') { e.preventDefault(); setCompanyHover(h => Math.min(h + 1, matches.length - 1)); }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setCompanyHover(h => Math.max(h - 1, 0)); }
                      else if (e.key === 'Enter') { e.preventDefault(); set('company', matches[companyHover]); commitCompany(matches[companyHover]); setCompanyOpen(false); }
                      else if (e.key === 'Escape') { setCompanyOpen(false); }
                    }}
                    placeholder="Type to search Table View companies…"
                    autoComplete="off"
                  />
                  {showList && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: 2,
                        zIndex: 30,
                        maxHeight: 240,
                        overflowY: 'auto',
                        background: '#fff',
                        border: '1px solid #CBD5E1',
                        borderRadius: 6,
                        boxShadow: '0 6px 16px rgba(15,23,42,0.12)',
                      }}
                    >
                      {matches.map((n, i) => (
                        <div
                          key={n}
                          onMouseDown={e => { e.preventDefault(); set('company', n); commitCompany(n); setCompanyOpen(false); }}
                          onMouseEnter={() => setCompanyHover(i)}
                          style={{
                            padding: '0.4rem 0.6rem',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            background: i === companyHover ? '#EFF6FF' : '#fff',
                            color: '#1E293B',
                            borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={n}
                        >{n}</div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Old Company <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(previous employer)</span></label><input style={inputStyle} value={f.oldCompany} onChange={e => set('oldCompany', e.target.value)} placeholder="Previous company name" /></div>
          <div style={{ gridColumn: 'span 2' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <label style={labelStyle}>LinkedIn URL</label>
              {(() => {
                // Three deep links: "View on LinkedIn" when a stored URL
                // exists, plus "Find on LinkedIn" / "Find on Sales Nav"
                // search links pre-filtered to name + company.
                const parts = [f.firstname, f.lastname, f.company].map(s => String(s || '').trim()).filter(Boolean);
                const keywords = parts.join(' ');
                const encoded = keywords ? encodeURIComponent(keywords) : null;
                const storedUrl = (f.hs_linkedin_url || '').trim();
                const viewHref = storedUrl ? (storedUrl.startsWith('http') ? storedUrl : `https://linkedin.com/in/${storedUrl}`) : null;
                if (!viewHref && !encoded) return null;
                return (
                  <span style={{ display: 'inline-flex', gap: 10 }}>
                    {viewHref && (
                      <a
                        href={viewHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open this contact's LinkedIn profile."
                        style={{ fontSize: '0.65rem', color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}
                      >View on LinkedIn ↗</a>
                    )}
                    {encoded && (
                      <a
                        href={`https://www.linkedin.com/search/results/people/?keywords=${encoded}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open regular LinkedIn people search pre-filtered to this name + company. Find the profile, copy the linkedin.com/in/ URL from their public profile, and paste it into the field below."
                        style={{ fontSize: '0.65rem', color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}
                      >Find on LinkedIn ↗</a>
                    )}
                    {encoded && (
                      <a
                        href={`https://www.linkedin.com/sales/search/people?keywords=${encoded}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open Sales Navigator people-search pre-filtered to this name + company."
                        style={{ fontSize: '0.65rem', color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}
                      >Find on Sales Nav ↗</a>
                    )}
                  </span>
                );
              })()}
            </div>
            <input style={inputStyle} value={f.hs_linkedin_url} onChange={e => set('hs_linkedin_url', e.target.value)} placeholder="https://www.linkedin.com/in/…" />
          </div>
          <div>
            <label style={labelStyle}>
              City
              {cityLookupStatus === 'loading' && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: '#94A3B8', fontWeight: 500 }}>looking up…</span>}
              {cityLookupStatus === 'auto' && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: '#059669', fontWeight: 600 }}>state auto-filled</span>}
              {cityLookupStatus === 'none' && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: '#94A3B8', fontWeight: 500 }}>no match</span>}
            </label>
            <div ref={cityBoxRef} style={{ position: 'relative' }}>
              {(() => {
                const matches = matchCities(f.city, CITY_OPTIONS).slice(0, 12);
                const showList = cityOpen && matches.length > 0;
                const runCityLookup = async (cityValue) => {
                  const city = (cityValue || '').trim();
                  if (!city) return;
                  if ((f.state || '').trim()) return; // don't override user's state
                  // Fast path: curated list. Cities marked ambiguous
                  // (Portland, Kansas City, Arlington, etc.) return
                  // null and we leave State alone — that matches the
                  // user's "skip if two cities in different states"
                  // rule. Only fall back to the geocoder if the city
                  // isn't in our list at all.
                  const local = getStateForCity(city);
                  if (local) {
                    if (local.state || local.country) {
                      setF(prev => {
                        const next = { ...prev };
                        if (local.state && !(prev.state || '').trim()) next.state = local.state;
                        if (local.country && !(prev.country || '').trim()) next.country = local.country;
                        return next;
                      });
                      setCityLookupStatus('auto');
                    }
                    return;
                  }
                  setCityLookupStatus('loading');
                  const result = await lookupStateForCity(city, f.country);
                  if (!result || !result.state) { setCityLookupStatus('none'); return; }
                  setF(prev => {
                    const next = { ...prev };
                    if (result.state && !(prev.state || '').trim()) next.state = result.state;
                    if (result.country && !(prev.country || '').trim()) next.country = result.country;
                    return next;
                  });
                  setCityLookupStatus('auto');
                };
                return (
                  <>
                    <input
                      style={inputStyle}
                      autoComplete="off"
                      placeholder="Type to search…"
                      value={f.city}
                      onFocus={() => { setCityOpen(true); setCityHover(0); }}
                      onChange={e => { setCityLookupStatus(''); set('city', e.target.value); setCityOpen(true); setCityHover(0); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && showList) {
                          e.preventDefault();
                          set('city', matches[cityHover]);
                          setCityOpen(false);
                          setCityLookupStatus('');
                          runCityLookup(matches[cityHover]);
                        } else if (e.key === 'ArrowDown' && showList) {
                          e.preventDefault();
                          setCityHover(h => Math.min(h + 1, matches.length - 1));
                        } else if (e.key === 'ArrowUp' && showList) {
                          e.preventDefault();
                          setCityHover(h => Math.max(h - 1, 0));
                        } else if (e.key === 'Escape') {
                          setCityOpen(false);
                        }
                      }}
                      onBlur={() => runCityLookup(f.city)}
                    />
                    {showList && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: 2,
                        zIndex: 30,
                        maxHeight: 220,
                        overflowY: 'auto',
                        background: '#fff',
                        border: '1px solid #CBD5E1',
                        borderRadius: 6,
                        boxShadow: '0 6px 16px rgba(15,23,42,0.12)',
                      }}>
                        {matches.map((n, i) => (
                          <div
                            key={n}
                            onMouseDown={e => {
                              e.preventDefault();
                              set('city', n);
                              setCityOpen(false);
                              setCityLookupStatus('');
                              runCityLookup(n);
                            }}
                            onMouseEnter={() => setCityHover(i)}
                            style={{
                              padding: '0.4rem 0.6rem',
                              fontSize: '0.78rem',
                              cursor: 'pointer',
                              background: i === cityHover ? '#EFF6FF' : '#fff',
                              color: '#1E293B',
                              borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={n}
                          >{n}</div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          <div>
            <label style={labelStyle}>State</label>
            <input style={inputStyle} list="state-list" value={f.state} onChange={e => {
              const val = e.target.value;
              setCityLookupStatus('');
              setF(prev => {
                const next = { ...prev, state: val };
                if (US_STATES.includes(val)) next.country = 'United States';
                return next;
              });
            }} placeholder="Start typing..." />
            <datalist id="state-list">
              {US_STATES.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={labelStyle}>Country</label>
            <input style={inputStyle} list="country-list" value={f.country} onChange={e => set('country', e.target.value)} placeholder="Start typing..." />
            <datalist id="country-list">
              {COUNTRIES.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Old Emails <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(comma-separated, inactive)</span></label><input style={inputStyle} value={f.oldEmails} onChange={e => set('oldEmails', e.target.value)} placeholder="old.email@company.com" /></div>
          <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Notes</label><textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '50px', lineHeight: 1.4 }} value={f.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Add notes about this contact..." /></div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={labelStyle}>Events <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(click to add / remove this contact from an event&apos;s attendee list)</span></label>
            {(!cid) ? (
              <div style={{ fontSize: '0.72rem', color: '#94A3B8', padding: '0.3rem 0' }}>Save the contact first to add them to events.</div>
            ) : events.length === 0 ? (
              <div style={{ fontSize: '0.72rem', color: '#94A3B8', padding: '0.3rem 0' }}>No events yet: create one in <strong>Contacts → Events</strong>.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', padding: '0.4rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', maxHeight: 120, overflowY: 'auto' }}>
                {events.map(ev => {
                  const inEvent = isContactInEvent(ev, cid);
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onToggleContactEvent && onToggleContactEvent(ev.id, contact)}
                      title={inEvent ? 'Remove from this event' : 'Add to this event'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        padding: '0.2rem 0.55rem', borderRadius: 999,
                        fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                        background: inEvent ? '#DCFCE7' : '#F8FAFC',
                        border: `1px solid ${inEvent ? '#86EFAC' : '#CBD5E1'}`,
                        color: inEvent ? '#166534' : '#475569',
                      }}
                    >
                      <span style={{ fontWeight: 800 }}>{inEvent ? '✓' : '+'}</span>
                      {ev.name || 'Untitled event'}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={labelStyle}>CC Emails <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(auto-CC when drafting an email to this contact)</span></label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', padding: '0.35rem', border: '1px solid #CBD5E1', borderRadius: 6, minHeight: 36, alignItems: 'center', background: '#fff' }}>
              {ccEmails.map(email => (
                <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.45rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 999, fontSize: '0.7rem', color: '#1E40AF' }}>
                  {email}
                  <button type="button" onClick={() => removeCc(email)} style={{ background: 'none', border: 'none', color: '#93C5FD', fontSize: '0.85rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1, fontFamily: 'inherit' }}>&times;</button>
                </span>
              ))}
              <div style={{ position: 'relative', flex: 1, minWidth: 120 }} ref={ccBoxRef}>
                <input
                  value={ccInput}
                  onChange={e => { setCcInput(e.target.value); setShowCcSuggestions(true); }}
                  onFocus={() => setShowCcSuggestions(true)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && ccInput.includes('@')) { e.preventDefault(); addCc(ccInput); }
                    if (e.key === 'Backspace' && !ccInput && ccEmails.length > 0) removeCc(ccEmails[ccEmails.length - 1]);
                  }}
                  placeholder={ccEmails.length === 0 ? 'Search contacts or type email…' : 'Add more…'}
                  style={{ border: 'none', outline: 'none', fontSize: '0.78rem', fontFamily: 'inherit', color: 'var(--color-text)', padding: '0.15rem 0', width: '100%', background: 'none' }}
                />
                {showCcSuggestions && ccSuggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: 160, overflowY: 'auto', marginTop: 2 }}>
                    {ccSuggestions.map(c => (
                      <button key={c.email} type="button" onClick={() => addCc(c.email)}
                        style={{ display: 'flex', flexDirection: 'column', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', borderBottom: '1px solid #F5F5F5' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--color-text)' }}>{c.name}</span>
                        <span style={{ fontSize: '0.65rem', color: '#9CA3AF' }}>{c.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={labelStyle}>To Also <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(auto-add to the To line alongside this contact)</span></label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', padding: '0.35rem', border: '1px solid #CBD5E1', borderRadius: 6, minHeight: 36, alignItems: 'center', background: '#fff' }}>
              {toAlsoEmails.map(email => (
                <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.45rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 999, fontSize: '0.7rem', color: '#92400E' }}>
                  {email}
                  <button type="button" onClick={() => removeToAlso(email)} style={{ background: 'none', border: 'none', color: '#FCD34D', fontSize: '0.85rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1, fontFamily: 'inherit' }}>&times;</button>
                </span>
              ))}
              <div style={{ position: 'relative', flex: 1, minWidth: 120 }} ref={toAlsoBoxRef}>
                <input
                  value={toAlsoInput}
                  onChange={e => { setToAlsoInput(e.target.value); setShowToAlsoSuggestions(true); }}
                  onFocus={() => setShowToAlsoSuggestions(true)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && toAlsoInput.includes('@')) { e.preventDefault(); addToAlso(toAlsoInput); }
                    if (e.key === 'Backspace' && !toAlsoInput && toAlsoEmails.length > 0) removeToAlso(toAlsoEmails[toAlsoEmails.length - 1]);
                  }}
                  placeholder={toAlsoEmails.length === 0 ? 'Search contacts or type email…' : 'Add more…'}
                  style={{ border: 'none', outline: 'none', fontSize: '0.78rem', fontFamily: 'inherit', color: 'var(--color-text)', padding: '0.15rem 0', width: '100%', background: 'none' }}
                />
                {showToAlsoSuggestions && toAlsoSuggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: 160, overflowY: 'auto', marginTop: 2 }}>
                    {toAlsoSuggestions.map(c => (
                      <button key={c.email} type="button" onClick={() => addToAlso(c.email)}
                        style={{ display: 'flex', flexDirection: 'column', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', borderBottom: '1px solid #F5F5F5' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--color-text)' }}>{c.name}</span>
                        <span style={{ fontSize: '0.65rem', color: '#9CA3AF' }}>{c.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={labelStyle}>Reports To <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(positions this contact below their manager in the By Category view)</span></label>
            {(() => {
              const selfId = contact.id || contact.vid;
              const rawSelected = (selfId && contactReportsTo[selfId]) || [];
              const selectedIds = (Array.isArray(rawSelected) ? rawSelected : [rawSelected]).map(String).filter(Boolean);
              const eligible = companyContacts.filter(c => String(c.id || c.vid || '') !== String(selfId || ''));
              function toggle(mgrId) {
                const next = selectedIds.includes(String(mgrId))
                  ? selectedIds.filter(id => id !== String(mgrId))
                  : [...selectedIds, String(mgrId)];
                if (selfId && onSaveReportsTo) onSaveReportsTo(selfId, next);
              }
              if (!selfId) {
                return <div style={{ fontSize: '0.7rem', color: '#94A3B8', fontStyle: 'italic', padding: '0.4rem 0.5rem', border: '1px dashed #E2E8F0', borderRadius: 6 }}>Save the contact first, then you can assign a manager.</div>;
              }
              return (
                <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.25rem 0' }}>
                  {eligible.length === 0 ? (
                    <div style={{ fontSize: '0.7rem', color: '#94A3B8', fontStyle: 'italic', padding: '0.35rem 0.55rem' }}>No other contacts on this company yet.</div>
                  ) : eligible.map(mgr => {
                    const mgrId = String(mgr.id || mgr.vid);
                    const checked = selectedIds.includes(mgrId);
                    const mgrName = [mgr.firstname, mgr.lastname].filter(Boolean).join(' ') || mgr.email || `Contact ${mgrId}`;
                    return (
                      <label key={mgrId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.55rem', cursor: 'pointer', fontSize: '0.75rem', color: '#1E293B', background: checked ? '#EFF6FF' : 'transparent' }}
                        onMouseEnter={e => { if (!checked) e.currentTarget.style.background = '#F8FAFC'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = checked ? '#EFF6FF' : 'transparent'; }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggle(mgrId)} style={{ accentColor: '#0078D4' }} />
                        <span>{mgrName}</span>
                        {mgr.jobtitle && <span style={{ fontSize: '0.65rem', color: '#64748B' }}>· {mgr.jobtitle}</span>}
                      </label>
                    );
                  })}
                </div>
              );
            })()}
          </div>
          <div
            style={{ gridColumn: 'span 2' }}
            ref={tagsRef}
            data-tags-picker="true"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span>Tags</span>
              {tagsSaveStatus && (
                <span style={{ fontSize: '0.6rem', fontWeight: 600, textTransform: 'none', letterSpacing: 0, color: tagsSaveStatus.startsWith('Saved') ? '#10B981' : tagsSaveStatus.startsWith('Sav') ? '#64748B' : '#DC2626' }}>{tagsSaveStatus}</span>
              )}
            </label>
            <button
              type="button"
              onClick={() => setTagsOpen(p => !p)}
              style={{ width: '100%', padding: '0.35rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '6px', fontSize: '0.78rem', fontFamily: 'inherit', background: '#fff', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: checkedTags.size === 0 ? '#94A3B8' : '#1E293B' }}
            >
              <span>
                {checkedTags.size === 0
                  ? 'Select tags…'
                  : [...checkedTags].join(', ')}
              </span>
              <span style={{ fontSize: '0.6rem', color: '#94A3B8' }}>{tagsOpen ? '▲' : '▼'}</span>
            </button>
            {tagsOpen && (() => {
              // One row per tag, answered Yes / No / Not sure / Sold / Not
              // sold. Yes and Sold both mean the tag is on the contact and go
              // to HubSpot as the tag; the rest are recorded here only, so a
              // tag left off can say WHY it's off — decided against, not yet
              // known, or true of the person but not yet bought by their
              // company — rather than being indistinguishable from one nobody
              // has looked at.
              const stateOf = (tag) => tagStateFrom(checkedTags.has(tag), verdictFor(tag));
              // Hide, Left and Test are housekeeping, not classifications:
              // the first two control whether a contact surfaces at all and
              // the third is a scratch value. They're still answerable rows,
              // they just don't belong in a score meant to say "have I worked
              // out what this person is about".
              const scored = visibleTagOptions.filter(t => !TAG_SCORE_EXCLUDED.has(t.toLowerCase()));
              // Either half counts: a tag with only a Not sold against it has
              // been thought about just as much as one answered No.
              const answered = scored.filter(t => {
                const st = stateOf(t);
                return !!(st.answer || st.status);
              }).length;
              const total = scored.length;
              const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
              const done = total > 0 && answered === total;
              // Two independent groups, not one row of five. ANSWER says
              // whether the area is this person's; STATUS says whether their
              // company has bought it. Both can be set, so "Yes · Not sold"
              // — theirs, not bought yet — is finally sayable.
              const ANSWERS = [
                { key: 'yes',     label: 'Yes',      on: { bg: '#DCFCE7', border: '#4ADE80', color: '#166534' },
                  tip: (tag) => `${tag} is this person's area. Puts the tag on in HubSpot, unless a Not sold below is holding it off` },
                { key: 'no',      label: 'No',       on: { bg: '#FEE2E2', border: '#FCA5A5', color: '#991B1B' },
                  tip: (tag) => `Record ${tag} as “No” — doesn't apply to this person. Kept here, not sent to HubSpot` },
                { key: 'unsure',  label: 'Not sure', on: { bg: '#FEF3C7', border: '#FCD34D', color: '#92400E' },
                  tip: (tag) => `Record ${tag} as “Not sure” — haven't worked it out yet. Kept here, not sent to HubSpot` },
              ];
              const STATUSES = [
                { key: 'sold',    label: 'Sold',     on: { bg: '#CCFBF1', border: '#5EEAD4', color: '#115E59' },
                  tip: (tag) => `Their company has bought ${tag}. Keeps the tag on, so they still come back in a general ${tag} pull` },
                { key: 'notsold', label: 'Not sold', on: { bg: '#EEF2FF', border: '#A5B4FC', color: '#3730A3' },
                  tip: (tag) => `Their company hasn't bought ${tag} yet. Takes the tag off whatever the answer says, so they stay out of a general ${tag} pull; find them again under the Not sold status on All Contacts` },
              ];
              return (
                <div style={{ marginTop: '2px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '0.4rem 0.7rem', borderBottom: '1px solid #E2E8F0',
                    background: done ? '#F0FDF4' : '#F8FAFC',
                    fontSize: '0.68rem', fontWeight: 700,
                    color: done ? '#166534' : '#475569',
                  }}>
                    <span title={`${answered} of ${total} scored tags have been answered. Hide, Left and Test are excluded — they're housekeeping, not classifications. Either half counts: an answer of Yes / No / Not sure, or a Sold / Not sold status on its own.`}>
                      Tagged {pct}%
                      <span style={{ fontWeight: 500, color: done ? '#15803D' : '#94A3B8' }}>
                        {' · '}{done ? 'all tags mapped' : `${answered} of ${total} mapped`}
                      </span>
                    </span>
                    <span style={{ fontWeight: 500, color: '#94A3B8' }}>“Yes” and “Sold” put the tag in HubSpot — “Not sold” holds it off</span>
                  </div>
                  {/* Tall enough for the whole vocabulary at once — the point
                      of the table is reading a contact's answers in one look,
                      and a cap that cut it off mid-list made you scroll a
                      dropdown to find out what you'd already answered. Still
                      capped, generously, so an expanded vocabulary can't push
                      the modal's own buttons off screen. */}
                  <div style={{ maxHeight: '60vh', overflowY: 'auto', overflowX: 'auto' }}>
                    {/* Fixed layout so the five columns keep the widths set
                        below and a long tag name wraps instead of shoving the
                        last column off the edge of the picker. */}
                    <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                      <thead>
                        {/* Two header rows: the group names say which
                            question each set of buttons answers, so the
                            five columns don't read as one choice of five. */}
                        <tr style={{ background: '#F1F5F9', color: '#94A3B8' }}>
                          <th />
                          <th colSpan={ANSWERS.length} style={GROUP_HEAD}>Answer</th>
                          <th colSpan={STATUSES.length} style={{ ...GROUP_HEAD, borderLeft: '1px solid #CBD5E1' }}>Status</th>
                        </tr>
                        <tr style={{ background: '#F1F5F9', color: '#475569' }}>
                          <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', fontWeight: 700, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Tag</th>
                          {ANSWERS.map(c => (
                            <th key={c.key} style={COL_HEAD}>{c.label}</th>
                          ))}
                          {STATUSES.map((c, i) => (
                            <th key={c.key} style={i === 0 ? { ...COL_HEAD, borderLeft: '1px solid #CBD5E1' } : COL_HEAD}>{c.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTagOptions.map(tag => {
                          const bucket = BUCKETS.find(b => b.tag === tag.toLowerCase());
                          const st = stateOf(tag);
                          const answered = !!(st.answer || st.status);
                          // The tag's own styling marks the rows that are
                          // actually in HubSpot — which a Not sold takes a
                          // row out of, however the answer reads.
                          const tagged = checkedTags.has(tag);
                          return (
                            <tr key={tag} style={{ borderBottom: '1px solid #F1F5F9', background: answered ? '#fff' : '#FCFCFD' }}>
                              <td style={{ padding: '0.3rem 0.5rem' }}>
                                <span style={{ fontWeight: tagged ? 600 : 400, color: tagged ? (bucket?.headerColor || '#1E293B') : (answered ? '#475569' : '#94A3B8') }}>{tag}</span>
                                {tagged && bucket && (
                                  <span style={{ marginLeft: 6, fontSize: '0.58rem', fontWeight: 700, color: bucket.headerColor, background: bucket.headerBg, padding: '1px 6px', borderRadius: 999 }}>{bucket.label}</span>
                                )}
                                {/* Otherwise the header's total reads as
                                    wrong: three of the rows on screen aren't
                                    in it. */}
                                {TAG_SCORE_EXCLUDED.has(tag.toLowerCase()) && (
                                  <span
                                    title="Housekeeping tag — answerable, but not counted in the Tagged %."
                                    style={{ marginLeft: 6, fontSize: '0.56rem', fontWeight: 600, color: '#94A3B8', background: '#F1F5F9', padding: '1px 5px', borderRadius: 999 }}
                                  >not scored</span>
                                )}
                              </td>
                              {[
                                ...ANSWERS.map(c => ({ c, active: st.answer === c.key, set: setTagAnswer, edge: false })),
                                ...STATUSES.map((c, i) => ({ c, active: st.status === c.key, set: setTagStatus, edge: i === 0 })),
                              ].map(({ c, active, set, edge }) => (
                                <td key={c.key} style={{ textAlign: 'center', padding: '0.25rem 0.1rem', borderLeft: edge ? '1px solid #E2E8F0' : undefined }}>
                                  <button
                                    type="button"
                                    onClick={() => set(tag, c.key)}
                                    title={active
                                      ? `${tag}: ${c.label} — click again to clear`
                                      : c.tip(tag)}
                                    style={{
                                      width: '100%', maxWidth: 50, padding: '0.15rem 0', borderRadius: 999, cursor: 'pointer',
                                      fontFamily: 'inherit', fontSize: '0.64rem',
                                      fontWeight: active ? 700 : 500,
                                      border: `1px solid ${active ? c.on.border : '#E2E8F0'}`,
                                      background: active ? c.on.bg : '#fff',
                                      color: active ? c.on.color : '#94A3B8',
                                    }}
                                  >{active ? c.label : '·'}</button>
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
        {error && <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#FEF2F2', borderRadius: '6px', fontSize: '0.75rem', color: '#DC2626' }}>{error}</div>}
        {companyNote && <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '6px', fontSize: '0.75rem', color: '#166534' }}>{companyNote}</div>}
        {mergeOpen && (() => {
          // Same-company contacts first, then every other contact the caller
          // handed over. A duplicate almost never has the company spelled the
          // same way — that's usually WHY it's a duplicate — so a pool built
          // from an exact company match couldn't offer the one contact you
          // opened this panel to merge. The list stays company-first so the
          // common case is still what you see before typing, and the search
          // box below now reaches the rest.
          const allCandidates = (companyContacts || [])
            .concat(Array.isArray(allContacts) ? allContacts : [])
            .filter(c => String(c.id || c.vid) !== String(contact.id || contact.vid));
          const seen = new Set();
          const unique = [];
          for (const c of allCandidates) {
            const k = String(c.id || c.vid || '');
            if (!k || seen.has(k)) continue;
            seen.add(k);
            unique.push(c);
          }
          const q = mergeQuery.trim().toLowerCase();
          const matches = q
            ? unique.filter(c => {
                const blob = [c.firstname, c.lastname, c.email, c.company, c.jobtitle].filter(Boolean).join(' ').toLowerCase();
                return blob.includes(q);
              }).slice(0, 30)
            : unique.slice(0, 30);
          return (
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6 }}>
              <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#92400E', marginBottom: '0.4rem' }}>
                Merge another contact INTO this one
              </div>
              <div style={{ fontSize: '0.7rem', color: '#92400E', marginBottom: '0.5rem' }}>
                The kept contact (this popup) inherits email history, notes, and engagements from whatever you pick below. The other contact is deleted in HubSpot.
              </div>
              <input
                type="text"
                value={mergeQuery}
                onChange={e => setMergeQuery(e.target.value)}
                placeholder="Search by name, email, company…"
                autoFocus
                style={{ width: '100%', padding: '0.4rem 0.55rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit', marginBottom: '0.4rem' }}
              />
              <div style={{ maxHeight: 220, overflowY: 'auto', background: '#fff', border: '1px solid #FDE68A', borderRadius: 4 }}>
                {matches.length === 0 ? (
                  <div style={{ padding: '0.6rem', fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic', textAlign: 'center' }}>
                    {unique.length === 0
                      ? 'No other contacts available to merge with.'
                      : `No contacts match "${mergeQuery}".`}
                  </div>
                ) : matches.map(c => {
                  const id = c.id || c.vid;
                  const name = [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || `Contact ${id}`;
                  const subtitle = [c.email, c.company, c.jobtitle].filter(Boolean).join(' · ');
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={mergeProcessing}
                      onClick={() => performMerge(id, name)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.5rem 0.6rem', background: 'transparent', border: 'none', borderBottom: '1px solid #FEF3C7', cursor: mergeProcessing ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#FEF3C7'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1E293B' }}>{name}</div>
                      {subtitle && <div style={{ fontSize: '0.66rem', color: '#64748B', marginTop: 2 }}>{subtitle}</div>}
                    </button>
                  );
                })}
              </div>
              {mergeError && (
                <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 4, fontSize: '0.72rem', color: '#991B1B' }}>{mergeError}</div>
              )}
              <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={mergeProcessing}
                  onClick={() => { setMergeOpen(false); setMergeQuery(''); setMergeError(''); }}
                  style={{ padding: '0.3rem 0.7rem', border: '1px solid #E2E8F0', borderRadius: 4, background: '#fff', fontSize: '0.72rem', fontFamily: 'inherit', cursor: 'pointer' }}
                >Close picker</button>
              </div>
            </div>
          );
        })()}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem' }}>
          {(contact.id || contact.vid) ? (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setMergeOpen(o => !o)}
                title="Merge another HubSpot contact INTO this one: keeps this contact, deletes the other after consolidating its history."
                style={{ padding: '0.5rem 1rem', border: '1px solid #FDE68A', borderRadius: 6, background: mergeOpen ? '#FEF3C7' : '#FFFBEB', color: '#92400E', fontSize: '0.78rem', fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600 }}
              >{mergeOpen ? 'Cancel merge' : 'Merge…'}</button>
              <button
                type="button"
                onClick={performDelete}
                disabled={deleting || saving}
                title="Permanently delete this contact from HubSpot."
                style={{ padding: '0.5rem 1rem', border: '1px solid #FCA5A5', borderRadius: 6, background: '#FEF2F2', color: '#B91C1C', fontSize: '0.78rem', fontFamily: 'inherit', cursor: (deleting || saving) ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: (deleting || saving) ? 0.6 : 1 }}
              >{deleting ? 'Deleting…' : 'Delete Contact'}</button>
            </div>
          ) : <span />}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {autosaveEnabled && (
              <span
                title="Edits save to HubSpot automatically a moment after you stop typing."
                style={{ fontSize: '0.7rem', color: saving ? '#0369A1' : !dirty ? '#059669' : '#B45309', fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                {saving ? 'Saving…' : !dirty ? 'All changes saved' : !emailLooksComplete ? 'Enter a valid email to save' : 'Saving shortly…'}
              </span>
            )}
            <button onClick={onClose} style={{ padding: '0.5rem 1rem', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer', color: '#64748B' }}>{autosaveEnabled ? 'Close' : 'Cancel'}</button>
            <button
              onClick={() => runSave({ auto: autosaveEnabled })}
              disabled={saving || (autosaveEnabled ? !dirty : saved) || !f.email.trim()}
              title={!f.email.trim() ? 'Email is required' : autosaveEnabled ? 'Edits save automatically: click to push them now' : ''}
              style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: (saved || (autosaveEnabled && !dirty)) ? '#059669' : (!f.email.trim() ? '#94A3B8' : '#0078D4'), color: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', cursor: (!f.email.trim() || saving || (autosaveEnabled && !dirty)) ? 'not-allowed' : 'pointer', fontWeight: 600, transition: 'background 0.2s', opacity: (!f.email.trim() && !saved) ? 0.6 : 1 }}
            >
              {saving ? 'Saving…' : !f.email.trim() ? 'Email required' : autosaveEnabled ? (dirty ? 'Save now' : '✓ Saved') : saved ? '✓ Saved!' : (!contact.id && !contact.vid) ? 'Create in HubSpot' : 'Save to HubSpot'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  const prevId = prev.contact.id || prev.contact.vid;
  const nextId = next.contact.id || next.contact.vid;
  const domainsEqual = (prev.emailDomains || []).join('|') === (next.emailDomains || []).join('|');
  // Compare the reportsTo array for this specific contact so changes rerender the picker.
  const prevMgrs = JSON.stringify((prev.contactReportsTo || {})[prevId] || []);
  const nextMgrs = JSON.stringify((next.contactReportsTo || {})[nextId] || []);
  const allContactsEqual = (prev.allContacts || []).length === (next.allContacts || []).length;
  const companyContactsEqual = (prev.companyContacts || []).length === (next.companyContacts || []).length
    && (prev.companyContacts || []).every((c, i) => (c.id || c.vid) === ((next.companyContacts || [])[i]?.id || (next.companyContacts || [])[i]?.vid));
  // Re-render when this contact's event membership (or any event's
  // id/name) changes, so the Events chips reflect toggles immediately.
  const eventSig = (events, id) => JSON.stringify((events || []).map(e => [
    e.id, e.name, (e.attendees || []).some(a => a.contactId && String(a.contactId) === String(id)),
  ]));
  const eventsEqual = eventSig(prev.events, prevId) === eventSig(next.events, nextId);
  return prevId === nextId && prev.onSave === next.onSave && prev.onClose === next.onClose && prev.tagOptions === next.tagOptions && prev.onSaveNote === next.onSaveNote && prev.onSaveOldEmails === next.onSaveOldEmails && prev.onSaveOldCompany === next.onSaveOldCompany && prev.onSaveNickname === next.onSaveNickname && prev.onSaveReportsTo === next.onSaveReportsTo && prevMgrs === nextMgrs && companyContactsEqual && allContactsEqual && domainsEqual && eventsEqual;
});

function SearchableSelect({ options, value, onChange, placeholder = 'Select…', allowCustom = true }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, up: false });
  const ref = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false); setFilter('');
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  useEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const up = spaceBelow < 260;
    setPos({
      top: up ? rect.top - 2 : rect.bottom + 2,
      left: rect.left,
      width: rect.width,
      up,
    });
  }, [open, filter]);

  const q = filter.trim().toLowerCase();
  const filtered = q ? options.filter(o => String(o).toLowerCase().includes(q)) : options;
  const exactMatch = filtered.some(o => String(o).toLowerCase() === q);

  function pick(v) {
    onChange(v);
    setOpen(false);
    setFilter('');
  }

  return (
    <div ref={ref}>
      <div
        onClick={() => { setOpen(o => !o); setFilter(''); }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.3rem',
          padding: '0.4rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '6px',
          minHeight: '36px', cursor: 'pointer', background: 'var(--color-bg)', fontSize: '0.78rem',
        }}
      >
        <span style={{ color: value ? 'var(--color-text)' : 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || placeholder}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>
          {value && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              title="Clear"
              style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '0.85rem', cursor: 'pointer', padding: 0, lineHeight: 1, fontFamily: 'inherit' }}
            >&times;</button>
          )}
          {open ? '▲' : '▼'}
        </span>
      </div>
      {open && createPortal(
        <div ref={dropRef} style={{
          position: 'fixed',
          top: pos.up ? undefined : pos.top,
          bottom: pos.up ? (window.innerHeight - pos.top) : undefined,
          left: pos.left,
          width: Math.max(pos.width, 240),
          zIndex: 10001,
          background: '#fff', border: '1px solid #E2E8F0', borderRadius: '6px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', maxHeight: '260px', display: 'flex', flexDirection: 'column',
        }}>
          <input
            type="text"
            placeholder="Search…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (filtered.length > 0) pick(filtered[0]);
                else if (allowCustom && filter.trim()) pick(filter.trim());
              } else if (e.key === 'Escape') {
                setOpen(false); setFilter('');
              }
            }}
            autoFocus
            style={{ margin: '0.3rem', padding: '0.3rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '4px', fontSize: '0.72rem', fontFamily: 'inherit', outline: 'none' }}
          />
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(opt => (
              <div
                key={opt}
                onClick={() => pick(opt)}
                style={{
                  padding: '0.35rem 0.6rem', fontSize: '0.74rem', cursor: 'pointer',
                  color: '#1E293B', background: opt === value ? '#EFF6FF' : 'transparent', fontWeight: opt === value ? 600 : 400,
                }}
                onMouseOver={e => { if (opt !== value) e.currentTarget.style.background = '#F1F5F9'; }}
                onMouseOut={e => { if (opt !== value) e.currentTarget.style.background = 'transparent'; }}
              >{opt}</div>
            ))}
            {filtered.length === 0 && !allowCustom && (
              <div style={{ padding: '0.5rem 0.6rem', fontSize: '0.7rem', color: '#94A3B8' }}>No matches</div>
            )}
            {allowCustom && filter.trim() && !exactMatch && (
              <div
                onClick={() => pick(filter.trim())}
                style={{ padding: '0.35rem 0.6rem', fontSize: '0.74rem', cursor: 'pointer', color: '#475569', borderTop: filtered.length > 0 ? '1px solid #F1F5F9' : 'none', fontStyle: 'italic' }}
                onMouseOver={e => e.currentTarget.style.background = '#F1F5F9'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}
              >Use “{filter.trim()}”</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// Provenance badges for how a Framework landed on a company: auto-mapped
// from a confirmed Lists-page mapping, manually picked in this popup, or
// pulled in from Claude sustainability research.
const FRAMEWORK_SOURCE_BADGES = {
  auto:   { label: 'Auto',   bg: '#E0E7FF', text: '#3730A3', title: 'Mapped automatically from a confirmed Lists-page mapping' },
  manual: { label: 'Manual', bg: '#F1F5F9', text: '#475569', title: 'Manually added in this company popup' },
  claude: { label: 'Claude', bg: '#DCFCE7', text: '#15803D', title: 'Added from Claude sustainability research' },
};

// `sourceOf(value)` is optional — when supplied (the Frameworks field), each
// selected pill shows a small provenance badge and auto-mapped pills drop
// the × since they're managed on the Lists page, not here.
function MultiSelectDropdown({ options, selected, onToggle, sourceOf = null }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, up: false });
  const ref = useRef(null);
  const dropRef = useRef(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false); setFilter('');
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  useEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const up = spaceBelow < 240;
    setPos({
      top: up ? rect.top - 2 : rect.bottom + 2,
      left: rect.left,
      width: rect.width,
      up,
    });
  }, [open, filter]);

  const filtered = filter.trim() ? options.filter(o => o.toLowerCase().includes(filter.toLowerCase())) : options;

  return (
    <div ref={ref}>
      <div
        onClick={() => { setOpen(o => !o); setFilter(''); }}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: '0.3rem', padding: '0.35rem 0.5rem',
          border: '1px solid var(--color-border)', borderRadius: '6px', minHeight: '36px',
          alignItems: 'center', cursor: 'pointer', background: 'var(--color-bg)',
        }}
      >
        {selected.length === 0 && <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Select...</span>}
        {selected.map(v => {
          const src = sourceOf ? sourceOf(v) : null;
          const badge = src ? FRAMEWORK_SOURCE_BADGES[src] : null;
          return (
          <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.1rem 0.5rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '999px', fontSize: '0.7rem', color: '#1E40AF', fontWeight: 500 }}>
            {v}
            {badge && (
              <span
                title={badge.title}
                style={{ display: 'inline-block', padding: '0 5px', borderRadius: 999, fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', background: badge.bg, color: badge.text }}
              >{badge.label}</span>
            )}
            {src !== 'auto' && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggle(v); }}
                style={{ background: 'none', border: 'none', color: '#93C5FD', fontSize: '0.8rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
              >&times;</button>
            )}
          </span>
          );
        })}
        <span style={{ marginLeft: 'auto', fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>{open ? '\u25B2' : '\u25BC'}</span>
      </div>
      {open && createPortal(
        <div ref={dropRef} style={{
          position: 'fixed',
          top: pos.up ? undefined : pos.top,
          bottom: pos.up ? (window.innerHeight - pos.top) : undefined,
          left: pos.left,
          width: Math.max(pos.width, 280),
          zIndex: 10001,
          background: '#fff', border: '1px solid #E2E8F0', borderRadius: '6px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', maxHeight: '240px', display: 'flex', flexDirection: 'column',
        }}>
          {options.length > 10 && (
            <input
              type="text"
              placeholder="Search..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              onClick={e => e.stopPropagation()}
              autoFocus
              style={{ margin: '0.3rem', padding: '0.3rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '4px', fontSize: '0.72rem', fontFamily: 'inherit', outline: 'none' }}
            />
          )}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(opt => (
              <label
                key={opt}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.6rem',
                  fontSize: '0.72rem', cursor: 'pointer', color: '#1E293B',
                }}
                onMouseOver={e => e.currentTarget.style.background = '#F1F5F9'}
                onMouseOut={e => e.currentTarget.style.background = ''}
              >
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => onToggle(opt)} style={{ accentColor: '#3B82F6' }} />
                {opt}
              </label>
            ))}
            {filtered.length === 0 && <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.7rem', color: '#94A3B8' }}>No matches</div>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// Build a flat set of all known service item names (lowercased) for scope matching
const ALL_SERVICE_ITEMS_LOWER = new Set(
  SERVICE_CATEGORIES.flatMap(cat => cat.items.map(i => i.toLowerCase()))
);

function SustainabilityResearchPanel({ state, onClear, onUseTargets, onMergeFrameworks }) {
  if (!state.loading && !state.data && !state.error) return null;
  const data = state.data;
  return (
    <div style={{ marginTop: '0.5rem', border: '1px solid #BBF7D0', background: '#F0FDF4', borderRadius: 6, padding: '0.6rem 0.75rem', fontSize: '0.75rem', color: '#14532D' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.4rem' }}>
        <strong style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Claude research</strong>
        <button type="button" onClick={onClear} aria-label="Dismiss" style={{ background: 'transparent', border: 'none', color: '#15803D', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 0 }}>×</button>
      </div>
      {state.loading && <div style={{ color: '#166534' }}>Searching the web and summarizing… this can take 20–40 seconds.</div>}
      {state.error && <div style={{ color: '#991B1B' }}>Research failed: {state.error}</div>}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {data.summary && (
            <div style={{ lineHeight: 1.4 }}>{data.summary}</div>
          )}
          {Array.isArray(data.programs) && data.programs.length > 0 && (
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Programs</div>
              <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                {data.programs.map((p, i) => <li key={i} style={{ lineHeight: 1.4 }}>{p}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(data.targets) && data.targets.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Targets</div>
                <button
                  type="button"
                  onClick={onUseTargets}
                  title="Append these targets to the Sustainability Targets field above"
                  style={{ padding: '0.15rem 0.5rem', border: '1px solid #86EFAC', borderRadius: 6, background: '#fff', color: '#15803D', fontSize: '0.62rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                >Use in Sustainability Targets</button>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                {data.targets.map((t, i) => <li key={i} style={{ lineHeight: 1.4 }}>{t}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(data.frameworks) && data.frameworks.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Frameworks found</div>
                <button
                  type="button"
                  onClick={onMergeFrameworks}
                  title="Add these frameworks to the Frameworks dropdown above"
                  style={{ padding: '0.15rem 0.5rem', border: '1px solid #86EFAC', borderRadius: 6, background: '#fff', color: '#15803D', fontSize: '0.62rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                >Add to Frameworks</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                {data.frameworks.map(f => (
                  <span key={f} style={{ padding: '1px 6px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC' }}>{f}</span>
                ))}
              </div>
            </div>
          )}
          {Array.isArray(data.reports) && data.reports.length > 0 && (
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Reports</div>
              <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                {data.reports.map((r, i) => (
                  <li key={i} style={{ lineHeight: 1.4 }}>
                    <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: '#15803D', textDecoration: 'underline' }}>
                      {r.title || r.url}
                    </a>
                    {r.year ? <span style={{ color: '#166534', marginLeft: 4 }}>({r.year})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(data.sources) && data.sources.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '0.65rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sources ({data.sources.length})</summary>
              <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1rem' }}>
                {data.sources.map((s, i) => (
                  <li key={i} style={{ lineHeight: 1.4 }}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: '#15803D', textDecoration: 'underline' }}>
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// Compact label for an SME chip: initials for a multi-word name ("Dan
// Baldauf" -> "DB"), otherwise the first few characters. The full name is
// on the chip's tooltip.
function smeInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] || '').slice(0, 4);
}

// Divisions — which other tracker companies are divisions (subsidiaries,
// operating brands, regional entities) of this one. The same mapping the
// My Accounts "Divisions" column edits, so rolled-up counts there pick up
// anything mapped here; both write through utils/divisions.js.
// One box plus, below it, its own divisions stacked off a vertical spine.
// Used from level 2 down; level 1 fans out horizontally instead (see
// DivisionsChart), which is what gives the chart its shape: a wide row of
// divisions, each growing a tidy column of sub-divisions.
// A small text box that commits on Enter or blur and cancels on Escape.
// Used for both renaming a box and typing a new one under it, so the two
// behave identically.
function DivisionInlineInput({ value, placeholder, onCommit, onCancel }) {
  const [text, setText] = useState(value || '');
  const ref = useRef(null);
  // Focus and select explicitly rather than relying on autoFocus: the
  // modal has document-level mousedown handlers, and selecting the old
  // name means a rename is just "type the new one".
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  return (
    <input
      ref={ref}
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={e => setText(e.target.value)}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); onCommit(text); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      onBlur={() => onCommit(text)}
      style={{
        width: '100%', boxSizing: 'border-box', padding: '0.4rem 0.4rem',
        border: '2px solid var(--color-accent)', borderRadius: 4,
        background: '#F8FBFF', color: 'var(--color-text)',
        fontSize: '0.72rem', fontFamily: 'inherit', textAlign: 'center',
        minHeight: '2.4rem',
      }}
    />
  );
}

// The people on a division, listed under its box, plus the picker that
// assigns them. Contacts come from the company's own contact list; a name
// that isn't on it can still be typed, the same way a division can.
function DivisionContactPicker({ boxId, contacts, assigned, actions }) {
  const [query, setQuery] = useState('');
  const assignedKeys = useMemo(
    () => new Set(assigned.map(divisionContactKey)), [assigned]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (contacts || [])
      .filter(c => !assignedKeys.has(c.id || nameKey(c.name)))
      .filter(c => !q
        || c.name.toLowerCase().includes(q)
        || (c.jobtitle || '').toLowerCase().includes(q)
        || (c.email || '').toLowerCase().includes(q)
        // Searching a team name pulls up that team, so a whole bucket can
        // be added without remembering who's on it.
        || (c.team || '').toLowerCase().includes(q))
      .slice(0, 12);
  }, [contacts, query, assignedKeys]);

  const typedIsNew = query.trim()
    && !matches.some(c => nameKey(c.name) === nameKey(query))
    && !assigned.some(c => nameKey(c.name) === nameKey(query));

  return (
    <>
      <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            marginTop: '0.25rem', border: '1px solid var(--color-accent)', borderRadius: 6,
            background: 'var(--color-surface)', padding: '0.25rem', textAlign: 'left',
          }}
        >
          <input
            type="text"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Escape') { e.preventDefault(); actions.cancel(); }
              if (e.key === 'Enter') {
                e.preventDefault();
                if (matches.length) actions.addContact(boxId, matches[0]);
                else if (query.trim()) actions.addContact(boxId, { id: '', name: query.trim() });
              }
            }}
            placeholder="Find or type a contact…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '0.2rem 0.3rem',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.65rem', fontFamily: 'inherit',
            }}
          />
          <div style={{ maxHeight: 130, overflowY: 'auto', marginTop: '0.15rem' }}>
            {matches.map(c => (
              <div
                key={c.id || c.name}
                onClick={() => actions.addContact(boxId, c)}
                style={{ padding: '0.15rem 0.3rem', fontSize: '0.65rem', color: c.left ? '#94A3B8' : '#1E293B', cursor: 'pointer', borderRadius: 3 }}
                onMouseOver={e => e.currentTarget.style.background = '#F1F5F9'}
                onMouseOut={e => e.currentTarget.style.background = ''}
              >
                {/* Someone tagged Left can still be put on a box — that's
                    how the chart keeps showing who used to cover it — but
                    the list says so rather than letting it pass unnoticed.
                    The team beside the name says which bucket they'll land
                    in once they're on. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span style={{ fontWeight: 600 }}>
                    {c.name}
                    {c.left && <span style={{ fontWeight: 500, color: '#94A3B8' }}> · left</span>}
                  </span>
                  {c.team && (
                    <span
                      title={`Team Name: ${c.team}`}
                      style={{
                        fontSize: '0.55rem', color: '#475569', background: '#E2E8F0',
                        borderRadius: 999, padding: '0 0.3rem', whiteSpace: 'nowrap',
                      }}
                    >{c.team}</span>
                  )}
                </div>
                {(c.jobtitle || c.email) && (
                  <div style={{ color: '#94A3B8', fontSize: '0.6rem' }}>{c.jobtitle || c.email}</div>
                )}
              </div>
            ))}
            {typedIsNew && (
              <div
                onClick={() => actions.addContact(boxId, { id: '', name: query.trim() })}
                style={{ padding: '0.2rem 0.3rem', fontSize: '0.63rem', color: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600 }}
              >
                + Add “{query.trim()}”
              </div>
            )}
            {!matches.length && !typedIsNew && (
              <div style={{ padding: '0.2rem 0.3rem', fontSize: '0.62rem', color: '#94A3B8' }}>
                {contacts.length ? 'Everyone here is already on this division.' : 'No contacts on this company yet.'}
              </div>
            )}
          </div>
      </div>
    </>
  );
}

// What hovering a contact chip opens: who they are and the note kept on
// them. Portalled to the body and positioned off the chip's own rect,
// because the chart scrolls sideways and clips anything drawn inside it,
// and pointer-transparent so it can't come between the cursor and the
// chip it belongs to. A long note is clipped here — the click that opens
// the contact popup is where the whole of it lives.
function DivisionContactCard({ rect, contact, info, managers, gone, mark, openable }) {
  const WIDTH = 300;
  const GAP = 6;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8));
  // Flip above the chip when there's more room up there than below it.
  const below = window.innerHeight - rect.bottom;
  const openUp = below < 200 && rect.top > below;
  const vertical = openUp
    ? { bottom: Math.round(window.innerHeight - rect.top + GAP) }
    : { top: Math.round(rect.bottom + GAP) };

  const note = String(info?.notes || '').trim();
  const jobtitle = info?.jobtitle || contact.jobtitle || '';
  const email = info?.email || contact.email || '';
  const team = info?.team || '';
  const line = { fontSize: '0.66rem', color: '#64748B', marginTop: '0.1rem' };

  return createPortal(
    <div
      style={{
        position: 'fixed', left, ...vertical, width: WIDTH, zIndex: 9000,
        pointerEvents: 'none', background: '#fff', border: '1px solid #E2E8F0',
        borderRadius: 8, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
        padding: '0.5rem 0.6rem', fontFamily: 'inherit', textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#1E293B' }}>{contact.name}</span>
        {gone && (
          <span style={{ fontSize: '0.55rem', fontWeight: 700, color: '#64748B', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 999, padding: '0 5px' }}>
            Left
          </span>
        )}
        {/* Says in words what the chip's symbol means, so nobody has to
            guess what a red ! is. */}
        {mark && (
          <span style={{ fontSize: '0.55rem', fontWeight: 700, color: mark.color, background: `${mark.color}14`, border: `1px solid ${mark.color}55`, borderRadius: 999, padding: '0 5px' }}>
            {mark.symbol} {mark.label}
          </span>
        )}
      </div>
      {jobtitle && <div style={line}>{jobtitle}</div>}
      {email && <div style={{ ...line, wordBreak: 'break-all' }}>{email}</div>}
      {team && <div style={line}>Team: {team}</div>}
      {managers.length > 0 && <div style={line}>Reports to {managers.join(', ')}</div>}
      <div style={{ borderTop: '1px solid #F1F5F9', margin: '0.4rem 0 0.35rem' }} />
      <div style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: '#94A3B8' }}>
        Notes
      </div>
      <div
        style={{
          fontSize: '0.68rem', lineHeight: 1.45, marginTop: '0.15rem',
          color: note ? '#334155' : '#94A3B8', fontStyle: note ? 'normal' : 'italic',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 190, overflow: 'hidden',
        }}
      >
        {note || (info ? 'No notes on this contact yet.' : 'Not in this company’s contact list — no notes to show.')}
      </div>
      {openable && (
        <div style={{ fontSize: '0.6rem', color: '#94A3B8', marginTop: '0.35rem' }}>
          Click the name to open the contact
        </div>
      )}
    </div>,
    document.body,
  );
}

// One person on a box, with anyone who reports to them — and is on the
// same box — nested underneath off a short spine.
//
// Colour is the person's standing: green while they're still there, grey
// once they're tagged Left. A leaver is never dropped from the chart —
// who used to cover a division is worth knowing, and quietly removing
// them would look like the mapping was never made.
function DivisionContactRow({ node, boxId, boxName, hasLeft, infoOf, sentimentOf, actions }) {
  const c = node.contact;
  const gone = hasLeft(c);
  // Champion or detractor, from the contact popup. Neutral draws nothing —
  // most people are neutral, so marking them would drown the two that
  // aren't.
  const mark = sentimentMark(sentimentOf ? sentimentOf(c) : '');
  const tone = gone
    ? { bg: '#F1F5F9', border: '#E2E8F0', text: '#94A3B8' }
    : { bg: '#ECFDF5', border: '#A7F3D0', text: '#065F46' };
  const managers = node.managerNames;
  // What the company's live contact list knows about this person — their
  // note, title, email, team. A name typed straight onto a box matches by
  // name; someone the list no longer carries matches nothing, and the
  // card says so rather than showing a blank.
  const info = infoOf ? infoOf(c) : null;
  const openable = !!info?.raw;
  const chipRef = useRef(null);
  const [hoverRect, setHoverRect] = useState(null);
  const showCard = useCallback(() => {
    const el = chipRef.current;
    if (el) setHoverRect(el.getBoundingClientRect());
  }, []);
  const hideCard = useCallback(() => setHoverRect(null), []);
  const open = useCallback(() => {
    if (info?.raw) actions.openContact(info.raw);
  }, [info, actions]);
  return (
    <div>
      <span
        ref={chipRef}
        onMouseEnter={showCard}
        onMouseLeave={hideCard}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.2rem',
          fontSize: '0.62rem', color: tone.text, background: tone.bg,
          border: `1px solid ${tone.border}`, borderRadius: 999, padding: '0.05rem 0.15rem 0.05rem 0.4rem',
        }}
      >
        <span
          role={openable ? 'button' : undefined}
          tabIndex={openable ? 0 : undefined}
          onClick={openable ? open : undefined}
          onFocus={showCard}
          onBlur={hideCard}
          onKeyDown={openable ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
          } : undefined}
          aria-label={openable ? `Open ${c.name}` : undefined}
          style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            cursor: openable ? 'pointer' : 'default',
            textDecoration: openable ? 'underline' : 'none',
            textDecorationStyle: 'dotted',
            textDecorationColor: gone ? '#CBD5E1' : '#6EE7B7',
            textUnderlineOffset: '2px',
            color: 'inherit', font: 'inherit',
          }}
        >
          {c.name}
        </span>
        {mark && (
          <span
            title={`${c.name} — ${mark.label}`}
            aria-label={mark.label}
            style={{
              flex: 'none', fontSize: '0.72rem', lineHeight: 1, fontWeight: 700,
              // A leaver's chip is grey all through; their standing is
              // history, so it greys with it rather than shouting from a
              // row that no longer applies.
              color: gone ? '#94A3B8' : mark.color,
            }}
          >{mark.symbol}</span>
        )}
        <button
          type="button"
          onClick={() => actions.removeContact(boxId, divisionContactKey(c))}
          aria-label={`Remove ${c.name} from ${boxName}`}
          title={`Remove ${c.name} from ${boxName}`}
          style={{ border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer', fontSize: '0.7rem', lineHeight: 1, padding: '0 0.15rem', fontFamily: 'inherit' }}
        >&times;</button>
      </span>
      {hoverRect && (
        <DivisionContactCard
          rect={hoverRect}
          contact={c}
          info={info}
          managers={managers}
          gone={gone}
          mark={mark}
          openable={openable}
        />
      )}
      {/* A manager who isn't on this box has no line to draw to, so their
          name goes under the chip instead — otherwise a mapped reporting
          line would simply be missing from the chart. */}
      {managers.length > 0 && (
        <div
          title={`${c.name} reports to ${managers.join(', ')}`}
          style={{
            fontSize: '0.55rem', color: '#94A3B8', textAlign: 'left',
            padding: '0 0.3rem 0 0.45rem', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >&#8593; {managers.join(', ')}</div>
      )}
      {node.children.length > 0 && (
        <div style={{
          marginTop: '0.12rem', marginLeft: '0.4rem', paddingLeft: '0.3rem',
          borderLeft: '1px solid #CBD5E1', display: 'flex', flexDirection: 'column', gap: '0.12rem',
        }}>
          {node.children.map(child => (
            <DivisionContactRow
              key={divisionContactKey(child.contact)}
              node={child}
              boxId={boxId}
              boxName={boxName}
              hasLeft={hasLeft}
              infoOf={infoOf}
              sentimentOf={sentimentOf}
              actions={actions}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// The people on a division, listed under its box and bucketed by the
// Team Name on their contact record when they carry one. A box where
// nobody has a team draws the plain list it always did — the headers
// only turn up once there's a team to head.
//
// Reporting lines are drawn WITHIN a bucket: teams are the coarser
// grouping, so a manager in another team is named under the chip the
// same way a manager on another box already was. Nothing about a
// reporting line is lost, it just isn't a nesting across teams.
//
// The picker above is a separate component so it mounts fresh every time
// it opens — otherwise its search text survived a close and prepended
// itself to the next one.
//
// `contactBook` carries what the chips need about the live contacts:
// who reports to whom (settings.contactReportsTo), who's tagged Left,
// and the Team Name each contact carries.
function DivisionContacts({ boxId, boxName, contacts, assigned, contactBook, picking, actions }) {
  const groups = useMemo(
    () => groupDivisionContactsByTeam(assigned, contactBook.teamOf)
      .map(g => ({
        ...g,
        nodes: buildDivisionContactTree(g.contacts, contactBook.reportsTo, contactBook.nameById),
      }))
      .filter(g => g.nodes.length > 0),
    [assigned, contactBook],
  );
  // One unlabelled bucket means nobody here has a Team Name: draw the
  // flat list rather than putting a "No team" header over the whole box.
  const bucketed = groups.some(g => g.team);
  // A person the company's contact list doesn't have — typed straight
  // onto the box, or since deleted — carries no Left tag, so they read
  // as still there. That's the same reading the contacts panel gives.
  const hasLeft = useCallback(
    (c) => contactBook.leftIds.has(String(c?.id || '')), [contactBook]);
  return (
    <>
      {groups.length > 0 && (
        <div style={{ marginTop: '0.2rem', display: 'flex', flexDirection: 'column', gap: bucketed ? '0.25rem' : '0.12rem' }}>
          {groups.map(group => (
            <div key={group.team || ' none'}>
              {bucketed && (
                <div
                  className={`${styles.divTeamLabel}${group.team ? '' : ` ${styles.divTeamNone}`}`}
                  title={group.team
                    ? `${group.team} — Team Name on ${group.contacts.length === 1 ? 'this contact' : 'these contacts'}`
                    : 'No Team Name on these contacts yet — set one on the contact to bucket them'}
                >
                  {group.team || 'No team'}
                </div>
              )}
              <div
                className={bucketed ? styles.divTeamChips : undefined}
                style={{ display: 'flex', flexDirection: 'column', gap: '0.12rem' }}
              >
                {group.nodes.map(node => (
                  <DivisionContactRow
                    key={divisionContactKey(node.contact)}
                    node={node}
                    boxId={boxId}
                    boxName={boxName}
                    hasLeft={hasLeft}
                    infoOf={contactBook.infoOf}
                    sentimentOf={contactBook.sentimentOf}
                    actions={actions}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {picking && (
        <DivisionContactPicker
          boxId={boxId}
          contacts={contacts}
          assigned={assigned}
          actions={actions}
        />
      )}
    </>
  );
}

// A box's children, laid out the way that box is set to: 'row' fans them
// out horizontally under a bus, 'column' stacks them off a vertical
// spine. Both shapes were already in the stylesheet — the root used one
// and everything below it the other — so this just lets any box pick.
function DivisionChildren({ node, layout, shared }) {
  const { adding, actions } = shared;
  const isAdding = adding === node.id;
  if (!node.children.length && !isAdding) return null;

  const kid = (child) => (
    <DivisionNode node={child} ownerId={node.id} {...shared} />
  );
  const newBox = (
    <div className={styles.divBoxWrap}>
      <DivisionInlineInput
        placeholder="New division…"
        onCommit={(text) => actions.addChild(node.id, text)}
        onCancel={actions.cancel}
      />
    </div>
  );

  if (layout === 'row') {
    return (
      <>
        <div className={styles.divStem} />
        <div className={styles.divRow}>
          {node.children.map(child => (
            <div key={child.id} className={styles.divCol}>{kid(child)}</div>
          ))}
          {isAdding && <div className={styles.divCol}>{newBox}</div>}
        </div>
      </>
    );
  }
  return (
    <div className={styles.divSub}>
      {node.children.map(child => (
        <div key={child.id} className={styles.divSubItem}>{kid(child)}</div>
      ))}
      {isAdding && <div className={styles.divSubItem}>{newBox}</div>}
    </div>
  );
}

// One box in the chart, plus its own divisions below it.
//
// `ownerId` is the id whose list this box lives in — renaming or removing
// the box edits that list, and a box added from here lands in THIS box's
// list (node.id), which is what nests it one level deeper.
function DivisionNode({ node, ownerId, editing, adding, picking, contacts, contactsByBox, contactBook, layoutOf, actions }) {
  const shared = { editing, adding, picking, contacts, contactsByBox, contactBook, layoutOf, actions };
  const isEditing = editing === node.id;
  const assigned = contactsByBox(node.id);
  const layout = layoutOf(node.id);
  const hasBelow = node.children.length > 0 || adding === node.id;
  const btn = {
    border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer',
    fontSize: '0.8rem', lineHeight: 1, padding: '0 0.15rem', fontFamily: 'inherit',
  };
  return (
    <>
      {/* The wrapper is what the connector elbow anchors to — see
          .divBoxWrap in the stylesheet. */}
      <div className={`${styles.divBoxWrap}${layout === 'row' && hasBelow ? ` ${styles.divBoxWrapWide}` : ''}`}>
        <div className={styles.divBoxHead}>
        {isEditing ? (
          <DivisionInlineInput
            value={node.company}
            onCommit={(text) => actions.rename(ownerId, node.id, text)}
            onCancel={actions.cancel}
          />
        ) : (
          <>
            <div
              className={`${styles.divBox}${node.missing ? ` ${styles.divBoxMissing}` : ''}`}
              style={{ cursor: 'text' }}
              onClick={() => actions.startEdit(node.id)}
              onDoubleClick={() => actions.startEdit(node.id)}
              title={node.missing
                ? `${node.company}: no longer in the tracker. Click to rename.`
                : `${node.company}: click to rename`}
            >
              {node.company || '-'}
            </div>
            <button
              type="button"
              onClick={() => actions.startAdd(node.id)}
              aria-label={`Add a division under ${node.company}`}
              title={`Add a division under ${node.company}`}
              style={{ ...btn, position: 'absolute', top: 1, left: 2 }}
            >+</button>
            {/* Clicking the label works too, but a visible control means
                nobody has to discover that. */}
            <button
              type="button"
              onClick={() => actions.startEdit(node.id)}
              aria-label={`Rename ${node.company}`}
              title={`Rename ${node.company}`}
              style={{ ...btn, position: 'absolute', bottom: 1, right: 2, fontSize: '0.68rem' }}
            >&#9998;</button>
            <button
              type="button"
              onClick={() => actions.remove(ownerId, node.id)}
              aria-label={`Remove ${node.company}`}
              title={`Remove ${node.company} from ${ownerId === node.id ? 'this list' : 'its parent'}`}
              style={{ ...btn, position: 'absolute', top: 1, right: 2 }}
            >&times;</button>
            <button
              type="button"
              onClick={() => actions.startPick(node.id)}
              aria-label={`Add a contact to ${node.company}`}
              title={`Add a contact to ${node.company}`}
              style={{ ...btn, position: 'absolute', bottom: 1, left: 2, fontSize: '0.7rem' }}
            >&#128100;</button>
            {hasBelow && (
              <button
                type="button"
                onClick={() => actions.toggleLayout(node.id, layout)}
                aria-label={`Lay out divisions under ${node.company} ${layout === 'row' ? 'vertically' : 'horizontally'}`}
                title={layout === 'row'
                  ? `Divisions under ${node.company} run across: click to stack them down`
                  : `Divisions under ${node.company} stack down: click to run them across`}
                style={{ ...btn, position: 'absolute', bottom: 1, left: '50%', transform: 'translateX(-50%)', fontSize: '0.7rem' }}
              >{layout === 'row' ? '\u21C5' : '\u21C4'}</button>
            )}
          </>
        )}
        </div>
        <DivisionContacts
          boxId={node.id}
          boxName={node.company}
          contacts={contacts}
          assigned={assigned}
          contactBook={contactBook}
          picking={picking === node.id}
          actions={actions}
        />
      </div>
      <DivisionChildren node={node} layout={layout} shared={shared} />
    </>
  );
}

// One box above the company: who it rolls up into. There's no separate
// mapping behind it — a parent is the same edge as a division read the
// other way round (see divisionParentsFor), so editing here shows up on
// the parent's own popup and its My Accounts Divisions cell.
//
// No "+" control: a division added under the parent would be a SIBLING of
// this company, and this chart doesn't draw siblings — a control whose
// result you can't see is worse than no control.
// The parent's OTHER divisions — this company's siblings. The chart is
// drawn around this company, so they're not boxes in it (that would be the
// parent's chart, not this one); they're listed under the parent box so a
// division of the parent can be added, renamed or removed from here rather
// than by opening the parent's own popup. The edits write the same
// divisionsMap entry that popup would, so the two can't drift.
function DivisionParentSiblings({ parent, adding, editing, actions }) {
  const isAdding = adding === parent.id;
  const siblings = parent.siblings || [];
  if (!siblings.length && !isAdding) return null;
  const btn = {
    border: 'none', background: 'transparent', cursor: 'pointer',
    fontFamily: 'inherit', lineHeight: 1.3, padding: 0,
  };
  return (
    <div style={{
      margin: '0.3rem auto 0', maxWidth: '13rem',
      display: 'flex', flexDirection: 'column', gap: 2,
      fontSize: '0.66rem', color: '#64748B', textAlign: 'left',
    }}>
      <div style={{ color: '#A8B2C1', fontWeight: 700 }}>
        Also under {parent.company || 'the parent'}
      </div>
      {siblings.map(sib => (editing === sib.id ? (
        <DivisionInlineInput
          key={sib.id}
          value={sib.company}
          placeholder="Division name…"
          onCommit={(text) => actions.rename(parent.id, sib.id, text)}
          onCancel={actions.cancel}
        />
      ) : (
        <div key={sib.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            onClick={() => actions.startEdit(sib.id)}
            title={`Rename ${sib.company}`}
            style={{ ...btn, color: '#475569', textAlign: 'left', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.66rem' }}
          >{sib.company || '-'}</button>
          <button
            type="button"
            onClick={() => actions.remove(parent.id, sib.id)}
            aria-label={`Remove ${sib.company}`}
            title={`Remove ${sib.company} from ${parent.company || 'the parent'}'s divisions`}
            style={{ ...btn, color: '#94A3B8', fontSize: '0.7rem' }}
          >&times;</button>
        </div>
      )))}
      {isAdding && (
        <DivisionInlineInput
          placeholder="New division…"
          onCommit={(text) => actions.addChild(parent.id, text)}
          onCancel={actions.cancel}
        />
      )}
    </div>
  );
}

function DivisionParentBox({ parent, rootCompany, editing, editingId, adding, picking, contacts, contactsByBox, contactBook, actions }) {
  const btn = {
    border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer',
    fontSize: '0.8rem', lineHeight: 1, padding: '0 0.15rem', fontFamily: 'inherit',
  };
  const others = parent.otherDivisions;
  return (
    <div className={styles.divBoxWrap}>
      <div className={styles.divBoxHead}>
        {editing ? (
          <DivisionInlineInput
            value={parent.company}
            placeholder="Parent company…"
            onCommit={(text) => actions.setParent(parent.id, text)}
            onCancel={actions.cancel}
          />
        ) : (
          <>
            <div
              className={`${styles.divBox} ${styles.divParent}${parent.missing ? ` ${styles.divBoxMissing}` : ''}`}
              style={{ cursor: 'text' }}
              onClick={() => actions.startEdit(parent.id)}
              onDoubleClick={() => actions.startEdit(parent.id)}
              title={[
                `${parent.company} is the parent of ${rootCompany}: click to change it.`,
                parent.missing ? 'No longer in the tracker.' : '',
                others > 0
                  ? `It has ${others} other division${others === 1 ? '' : 's'} — open its own popup to see them.`
                  : '',
              ].filter(Boolean).join(' ')}
            >
              {parent.company || '-'}
            </div>
            <button
              type="button"
              onClick={() => actions.startEdit(parent.id)}
              aria-label={`Change the parent company of ${rootCompany}`}
              title={`Change the parent company of ${rootCompany}`}
              style={{ ...btn, position: 'absolute', bottom: 1, right: 2, fontSize: '0.68rem' }}
            >&#9998;</button>
            <button
              type="button"
              onClick={() => actions.removeParent(parent.id)}
              aria-label={`Remove ${parent.company} as the parent of ${rootCompany}`}
              title={`Remove ${parent.company} as the parent: ${rootCompany} stops being one of its divisions.`}
              style={{ ...btn, position: 'absolute', top: 1, right: 2 }}
            >&times;</button>
            <button
              type="button"
              onClick={() => actions.startAdd(parent.id)}
              aria-label={`Add a division under ${parent.company}`}
              title={`Add a division under ${parent.company}: another company alongside ${rootCompany}.`}
              style={{ ...btn, position: 'absolute', top: 1, left: 2 }}
            >+</button>
            <button
              type="button"
              onClick={() => actions.startPick(parent.id)}
              aria-label={`Add a contact to ${parent.company}`}
              title={`Add a contact to ${parent.company}`}
              style={{ ...btn, position: 'absolute', bottom: 1, left: 2, fontSize: '0.7rem' }}
            >&#128100;</button>
          </>
        )}
      </div>
      <DivisionContacts
        boxId={parent.id}
        boxName={parent.company}
        contacts={contacts}
        assigned={contactsByBox(parent.id)}
        contactBook={contactBook}
        picking={picking === parent.id}
        actions={actions}
      />
      <DivisionParentSiblings
        parent={parent}
        adding={adding}
        editing={editingId}
        actions={actions}
      />
    </div>
  );
}

// The parent row, drawn above the root as the mirror of the level-1
// fan-out: a bus with a drop per parent, then one stem into the company.
// Normally there's a single parent and the bus collapses to that stem;
// more than one only happens when the mapping has it, and drawing them
// all beats hiding an edge the user can't otherwise find to undo.
function DivisionParents({ parents, addingParent, rootCompany, editing, adding, picking, contacts, contactsByBox, contactBook, actions }) {
  if (!parents.length && !addingParent) return null;
  return (
    <>
      <div className={styles.divParentRow}>
        {parents.map(parent => (
          <div key={parent.id} className={styles.divParentCol}>
            <DivisionParentBox
              parent={parent}
              rootCompany={rootCompany}
              editing={editing === parent.id}
              editingId={editing}
              adding={adding}
              picking={picking}
              contacts={contacts}
              contactsByBox={contactsByBox}
              contactBook={contactBook}
              actions={actions}
            />
          </div>
        ))}
        {addingParent && (
          <div className={styles.divParentCol}>
            <div className={styles.divBoxWrap}>
              <DivisionInlineInput
                placeholder="Parent company…"
                onCommit={(text) => actions.setParent(null, text)}
                onCancel={actions.cancel}
              />
            </div>
          </div>
        )}
      </div>
      <div className={styles.divStem} />
    </>
  );
}

// The root box is the company the popup is showing, so it isn't renamable
// or removable here — its own name field is a few rows up. Everything
// below it is editable in place, and the parent above it is set here.
function DivisionsChart({ tree, parents, addingParent, editing, adding, picking, contacts, contactsByBox, contactBook, layoutOf, actions }) {
  const shared = { editing, adding, picking, contacts, contactsByBox, contactBook, layoutOf, actions };
  const rootLayout = layoutOf(tree.id, 'row');
  const rootHasBelow = tree.children.length > 0 || adding === tree.id;
  return (
    <div className={styles.divChart}>
      <div className={styles.divChartInner}>
        <DivisionParents
          parents={parents}
          addingParent={addingParent}
          rootCompany={tree.company}
          editing={editing}
          adding={adding}
          picking={picking}
          contacts={contacts}
          contactsByBox={contactsByBox}
          contactBook={contactBook}
          actions={actions}
        />
        <div className={styles.divRootRow}>
          <div className={styles.divBoxWrap}>
            <div className={styles.divBoxHead}>
            <div
              className={`${styles.divBox} ${styles.divRoot}`}
              title={`${tree.company} is this company: rename it in the Company field above, not here.`}
            >{tree.company || '-'}</div>
            <button
              type="button"
              onClick={() => actions.startAdd(tree.id)}
              aria-label={`Add a division under ${tree.company}`}
              title={`Add a division under ${tree.company}`}
              style={{
                position: 'absolute', top: 1, left: 2, border: 'none', background: 'transparent',
                color: '#94A3B8', cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1,
                padding: '0 0.15rem', fontFamily: 'inherit',
              }}
            >+</button>
            <button
              type="button"
              onClick={() => actions.startPick(tree.id)}
              aria-label={`Add a contact to ${tree.company}`}
              title={`Add a contact to ${tree.company}`}
              style={{
                position: 'absolute', bottom: 1, left: 2, border: 'none', background: 'transparent',
                color: '#94A3B8', cursor: 'pointer', fontSize: '0.7rem', lineHeight: 1,
                padding: '0 0.15rem', fontFamily: 'inherit',
              }}
            >&#128100;</button>
            {rootHasBelow && (
              <button
                type="button"
                onClick={() => actions.toggleLayout(tree.id, rootLayout)}
                aria-label={`Lay out divisions under ${tree.company} ${rootLayout === 'row' ? 'vertically' : 'horizontally'}`}
                title={rootLayout === 'row'
                  ? `Divisions run across: click to stack them down`
                  : `Divisions stack down: click to run them across`}
                style={{
                  position: 'absolute', bottom: 1, left: '50%', transform: 'translateX(-50%)',
                  border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer',
                  fontSize: '0.7rem', lineHeight: 1, padding: '0 0.15rem', fontFamily: 'inherit',
                }}
              >{rootLayout === 'row' ? '\u21C5' : '\u21C4'}</button>
            )}
            </div>
            <DivisionContacts
              boxId={tree.id}
              boxName={tree.company}
              contacts={contacts}
              assigned={contactsByBox(tree.id)}
              contactBook={contactBook}
              picking={picking === tree.id}
              actions={actions}
            />
          </div>
        </div>
        <DivisionChildren node={tree} layout={rootLayout} shared={shared} />
      </div>
    </div>
  );
}

function DivisionsSection({ parentId, parentCompany, prospects, contacts, settings, updateSettings, onOpenContact = () => {} }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // Which box is being renamed, and which box is having one added under
  // it. Only one of each at a time, so a stray click can't leave two
  // editors open on the same chart.
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(null);
  const [picking, setPicking] = useState(null);
  // The parent box has no id until it's committed, so "typing a new one"
  // needs its own flag rather than riding on `editing`.
  const [addingParent, setAddingParent] = useState(false);

  const divisions = divisionsFor(settings, parentId);

  // Every company in the tracker, sorted, minus this one.
  const companies = useMemo(() => (prospects || [])
    .filter(p => p?.id && p.id !== parentId && String(p.company || '').trim())
    .map(p => ({ id: p.id, company: p.company, status: p.status }))
    .sort((a, b) => a.company.localeCompare(b.company)), [prospects, parentId]);

  // Live name per company id, so the chart labels every box with the
  // company's current name rather than the one stored when it was mapped.
  const nameById = useMemo(() => {
    const m = new Map();
    for (const p of (prospects || [])) {
      if (p?.id && String(p.company || '').trim()) m.set(p.id, p.company);
    }
    return m;
  }, [prospects]);

  // The company's contacts, flattened to
  // { id, name, jobtitle, email, left, team }. Contacts arrive in a couple
  // of shapes (HubSpot `vid` vs `id`), so the id is resolved the same way
  // the contacts panel does it. `left` is the Left tag, carried so the
  // picker can say who's already gone; `team` is the Team Name typed on
  // the contact — read live, so a team renamed there re-buckets the chart
  // rather than freezing at whatever it said when the contact was put on
  // a division.
  //
  // teamNames is memoized so an absent map doesn't hand out a fresh {}
  // every render and re-run everything keyed on it.
  const teamNames = useMemo(() => settings?.contactTeamNames || {}, [settings?.contactTeamNames]);
  // The per-user note map, read the same way the contacts table and the
  // contact popup read it: the locally saved note wins, and the HubSpot
  // fields are the fallback for a contact that never had one typed here.
  const contactNotes = useMemo(() => settings?.contactNotes || {}, [settings?.contactNotes]);
  // Champion / detractor, set on the contact popup — what the chart marks
  // people with. Memoized for the same reason teamNames is.
  const sentimentMap = useMemo(() => settings?.contactSentiment || {}, [settings?.contactSentiment]);
  const contactOptions = useMemo(() => (contacts || []).map(c => ({
    id: String(c.id || c.vid || c.email || ''),
    name: [c.firstname, c.lastname].filter(Boolean).join(' ').trim() || c.email || '(no name)',
    jobtitle: c.jobtitle || '',
    email: c.email || '',
    left: contactHasTag(c, 'left'),
    // Keyed on id||vid, the same key the contact editor saves under.
    team: String(teamNames[String(c.id || c.vid || '')] || '').trim(),
    sentiment: sentimentFor(sentimentMap, c.id || c.vid),
    notes: String(contactNotes[String(c.id || c.vid || '')] || c.notes || c.hs_content_membership_notes || c.message || ''),
    // The contact record itself, so clicking a chip can hand the whole
    // thing to the contact popup rather than the trimmed-down shape here.
    raw: c,
  })).filter(c => c.name), [contacts, teamNames, contactNotes, sentimentMap]);

  // A division chip carries only what was stored when the person was put
  // on the box, so everything live about them — note, title, team, and
  // the record the popup needs — is looked back up here. By id when the
  // chip has one, by name for someone typed in by hand.
  const contactIndex = useMemo(() => {
    const byId = new Map();
    const byName = new Map();
    for (const c of contactOptions) {
      if (c.id) byId.set(String(c.id), c);
      if (c.name && !byName.has(nameKey(c.name))) byName.set(nameKey(c.name), c);
    }
    return { byId, byName };
  }, [contactOptions]);
  const infoOf = useCallback((c) => (
    (c?.id && contactIndex.byId.get(String(c.id)))
    || contactIndex.byName.get(nameKey(c?.name))
    || null
  ), [contactIndex]);

  // What the chips need about the live contacts behind them: the
  // contact-level reporting map (the same one the By Category org chart
  // draws), who's tagged Left, the team each person is bucketed under, and
  // a name per contact id so a manager sitting on another box can still
  // be named.
  const contactBook = useMemo(() => {
    const leftIds = new Set();
    const contactNames = new Map();
    // Team by normalized name, for the fallback below.
    const teamByName = new Map();
    // Standing by normalized name, for the same fallback.
    const sentimentByName = new Map();
    for (const c of contactOptions) {
      if (c.team && c.name && !teamByName.has(nameKey(c.name))) teamByName.set(nameKey(c.name), c.team);
      if (c.sentiment && c.name && !sentimentByName.has(nameKey(c.name))) sentimentByName.set(nameKey(c.name), c.sentiment);
      if (!c.id) continue;
      contactNames.set(c.id, c.name);
      if (c.left) leftIds.add(c.id);
    }
    // A manager can be someone this company's list no longer carries —
    // they were mapped onto a box back when it did — so the names stored
    // on the boxes themselves fill the gaps.
    for (const list of Object.values(settings?.divisionContacts || {})) {
      for (const c of (list || [])) {
        const id = String(c?.id || '');
        if (id && c.name && !contactNames.has(id)) contactNames.set(id, c.name);
      }
    }
    return {
      reportsTo: settings?.contactReportsTo || {},
      leftIds,
      nameById: contactNames,
      // The team a division contact is bucketed under. Someone assigned
      // from the picker carries the id they were found under, so the team
      // comes straight off the contact record; a name typed in by hand has
      // no id, so fall back to matching the company's contact list by name
      // — that's how a typed "Dan Egan" still lands in his team.
      teamOf: (c) => {
        const byId = c?.id ? String(teamNames[String(c.id)] || '').trim() : '';
        return byId || teamByName.get(nameKey(c?.name)) || '';
      },
      // Where a chip's person stands, looked up the same way their team is:
      // by the id they were assigned under, and by name for someone typed
      // straight onto a box.
      sentimentOf: (c) => (
        (c?.id ? sentimentFor(sentimentMap, c.id) : '')
        || sentimentByName.get(nameKey(c?.name))
        || ''
      ),
      // What the hover card reads: the live contact behind a chip, or
      // null when this company's list no longer carries them.
      infoOf,
    };
  }, [contactOptions, teamNames, sentimentMap, settings?.divisionContacts, settings?.contactReportsTo, infoOf]);

  const contactsByBox = useCallback(
    (boxId) => divisionContactsFor(settings, boxId), [settings]);

  // How each box arranges what's under it. The company's own divisions
  // default to running across the page and everything deeper to stacking
  // down — the shape the chart always had — until a box is flipped.
  const layoutOf = useCallback(
    (boxId, fallback = 'column') => divisionLayoutFor(settings, boxId, fallback), [settings]);

  // Sub-divisions come along for free: a division's own divisions nest
  // under it, so the chart shows the whole structure, not just one level.
  const tree = useMemo(
    () => buildDivisionTree(settings, parentId, parentCompany, nameById),
    [settings, parentId, parentCompany, nameById],
  );

  // Who this company rolls up into — the box above the root. `otherDivisions`
  // is what else hangs off that parent, which this chart doesn't draw: worth
  // saying in the tooltip so the single box doesn't read as "the parent has
  // one division".
  const parents = useMemo(
    () => divisionParentsFor(settings, parentId, nameById).map(p => {
      // The parent's divisions other than this company. Listed under the
      // parent box (see DivisionParentSiblings) so they can be added and
      // maintained here; excluded by id rather than counted off the total,
      // so the tally stays right even if this company somehow isn't in
      // the parent's list.
      const siblings = divisionsFor(settings, p.id)
        .filter(d => d?.id && d.id !== parentId)
        .map(d => ({ id: d.id, company: nameById.get(d.id) || d.company || '' }));
      return { ...p, siblings, otherDivisions: siblings.length };
    }),
    [settings, parentId, nameById],
  );

  // Same normalization the add helper uses, so the disabled Add button and
  // the note under it agree with what actually gets rejected.
  const normalize = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const alreadyMapped = useMemo(() => {
    const key = normalize(draft);
    return !!key && divisions.some(d => normalize(d.company) === key);
  }, [draft, divisions]);

  // Divisions are typed in, one at a time: nothing here adds a division
  // you didn't write down. When the text happens to name a company already
  // in the tracker the entry links to it — that's what lets its own
  // divisions nest in the chart — but the typed name is what counts.
  function addTyped() {
    const patch = addNamedDivisionPatch(settings, parentId, draft, companies);
    // null = blank or already mapped; keep the text so it isn't just eaten.
    if (patch) { updateSettings(patch); setDraft(''); }
  }

  // Chart editing. Every box can be renamed, removed, or given a division
  // of its own — a box added under X lands in X's list, which is what
  // nests it a level deeper. Adding under a box that's linked to a tracker
  // company writes that company's own divisions, the same list its popup
  // and the My Accounts column edit; that's what the link means.
  const actions = useMemo(() => ({
    startEdit: (id) => { setAdding(null); setPicking(null); setAddingParent(false); setEditing(id); },
    startAdd: (id) => { setEditing(null); setPicking(null); setAddingParent(false); setAdding(id); },
    startPick: (id) => { setEditing(null); setAdding(null); setAddingParent(false); setPicking(id); },
    startAddParent: () => { setEditing(null); setAdding(null); setPicking(null); setAddingParent(true); },
    cancel: () => { setEditing(null); setAdding(null); setPicking(null); setAddingParent(false); },
    // Setting a parent writes the same edge a division does, pointed the
    // other way: this company joins that company's divisions. `fromId` is
    // the parent being replaced, so changing the box moves the company
    // rather than leaving it under both.
    setParent: (fromId, text) => {
      const patch = setDivisionParentPatch(settings, parentId, parentCompany, text, companies, fromId);
      if (patch) updateSettings(patch);
      setEditing(null);
      setAddingParent(false);
    },
    removeParent: (fromId) => updateSettings(removeDivisionPatch(settings, fromId, parentId)),
    rename: (ownerId, childId, text) => {
      const patch = renameDivisionPatch(settings, ownerId, childId, text);
      if (patch) {
        // A rename that detaches a linked division changes its id, so the
        // people on it have to travel with it or they'd be orphaned under
        // an id nothing points at any more.
        const newId = (patch.divisionsMap[ownerId] || []).find(d => nameKey(d.company) === nameKey(text))?.id;
        const moved = newId && newId !== childId
          ? moveDivisionContactsPatch(settings, childId, newId)
          : null;
        updateSettings(moved ? { ...patch, ...moved } : patch);
      }
      setEditing(null);
    },
    addContact: (boxId, contact) => {
      const patch = addDivisionContactPatch(settings, boxId, contact);
      if (patch) updateSettings(patch);
      setPicking(null);
    },
    removeContact: (boxId, key) => updateSettings(removeDivisionContactPatch(settings, boxId, key)),
    // Clicking a chip opens the same contact popup the contacts table
    // opens, on the live record — so an edit made there is an edit to the
    // contact, not to a copy the chart happens to hold.
    openContact: (raw) => { if (raw) onOpenContact(raw); },
    toggleLayout: (boxId, current) => {
      const patch = setDivisionLayoutPatch(settings, boxId, current === 'row' ? 'column' : 'row');
      if (patch) updateSettings(patch);
    },
    addChild: (ownerId, text) => {
      const patch = addNamedDivisionPatch(settings, ownerId, text, companies);
      if (patch) updateSettings(patch);
      setAdding(null);
    },
    remove: (ownerId, childId) => updateSettings(removeDivisionPatch(settings, ownerId, childId)),
  }), [settings, companies, updateSettings, parentId, parentCompany, onOpenContact]);

  return (
    <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <label className={styles.label} style={{ margin: 0, cursor: 'pointer' }}>Divisions</label>
        <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>&#9660;</span>
        {divisions.length > 0 && (
          <span style={{ fontSize: '0.68rem', color: '#64748B' }}>
            {divisions.length} {divisions.length === 1 ? 'division' : 'divisions'}
          </span>
        )}
      </div>

      {open && (
        <div style={{ marginTop: '0.6rem' }}>
          <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: '0 0 0.5rem' }}>
            Type the divisions of {parentCompany || 'this company'}: subsidiaries, operating brands,
            regional entities: one per entry. Click any box to rename it, + to add one beneath it,
            × to remove it. Nothing is added for you. My Accounts rolls a division's sites up under the
            parent by name, so spell it the way it appears on the site list.
          </p>

          {/* The company can sit under one too — offered here rather than
              inside the chart because the chart isn't drawn until there's
              something in it. */}
          {parents.length === 0 && !addingParent && (
            <button
              type="button"
              onClick={actions.startAddParent}
              title={`Put a parent company above ${parentCompany || 'this company'}: it becomes one of that company's divisions.`}
              style={{
                display: 'block', margin: '0 0 0.5rem', padding: '0.2rem 0.5rem',
                border: '1px dashed var(--color-border)', borderRadius: 6,
                background: 'transparent', color: '#64748B', cursor: 'pointer',
                fontSize: '0.68rem', fontFamily: 'inherit',
              }}
            >&#8593; Add a parent company</button>
          )}

          {/* The map is the editor: click a box to rename it, + to add one
              under it, × to remove it. */}
          {(divisions.length > 0 || adding || parents.length > 0 || addingParent) && (
            <>
              <DivisionsChart
                tree={tree}
                parents={parents}
                addingParent={addingParent}
                editing={editing}
                adding={adding}
                picking={picking}
                contacts={contactOptions}
                contactsByBox={contactsByBox}
                contactBook={contactBook}
                layoutOf={layoutOf}
                actions={actions}
              />
              <p style={{ fontSize: '0.66rem', color: '#94A3B8', margin: '0 0 0.5rem', textAlign: 'center' }}>
                Click a box or ✎ to rename it · + adds a division beneath it · 👤 adds a contact ·
                ⇄ / ⇅ switches that box's divisions between across and down · × removes it
                {parents.length > 0 && ' · the top box is the parent: this company shows as one of its divisions, and its + adds another division alongside this one'}
              </p>
              {/* Says where the buckets and the nesting come from — both
                  are read off the contacts themselves (their Team Name and
                  their Reports To), never set here — and what the two chip
                  colours mean. */}
              <p style={{ fontSize: '0.66rem', color: '#94A3B8', margin: '0 0 0.5rem', textAlign: 'center' }}>
                Contacts bucket by their Team Name and sit under whoever they report to
                (both set on the contact) · <span style={{ color: '#065F46' }}>green</span> is
                still at the company · <span style={{ color: '#64748B' }}>grey</span> is tagged Left ·
                ↑ names a manager outside their bucket · hover a name to read their notes,
                click it to open the contact
              </p>
            </>
          )}

          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <input
              type="text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); addTyped(); }
                if (e.key === 'Escape') setDraft('');
              }}
              placeholder="Type a division name…"
              className={styles.input}
              style={{ fontSize: '0.75rem', flex: 1 }}
            />
            <button
              type="button"
              onClick={addTyped}
              disabled={!draft.trim() || alreadyMapped}
              title={alreadyMapped ? 'Already a division of this company' : 'Add this division'}
              style={{
                padding: '0.35rem 0.75rem', border: 'none', borderRadius: 6,
                background: (draft.trim() && !alreadyMapped) ? 'var(--color-accent)' : '#E2E8F0',
                color: '#fff', fontSize: '0.72rem', fontWeight: 600,
                cursor: (draft.trim() && !alreadyMapped) ? 'pointer' : 'default', fontFamily: 'inherit',
              }}
            >Add</button>
          </div>
          {alreadyMapped && (
            <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: '0.3rem 0 0' }}>
              “{draft.trim()}” is already a division of this company.
            </p>
          )}

          {divisions.length === 0 && !draft.trim() && (
            <p style={{ fontSize: '0.7rem', color: '#94A3B8', margin: '0.5rem 0 0' }}>
              No divisions mapped yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ProspectModal({ prospect, prospects = [], onSave, onClose, isNew, onDeleteProspect, onUpdateProspect, hubspotContacts = [], onDeleteContact, orgCharts = {}, onUpdateOrgChart = () => {}, settings = {}, updateSettings = () => {}, updateSettingsPath = () => {}, targetAccountsData = null, cdmName = '', initialEditContact = null, onSelectProspect = null }) {
  const { isAdmin, user } = useAuth();
  const [fields, setFields] = useState(() => {
    if (prospect) return { ...EMPTY, ...prospect };
    return { ...EMPTY };
  });

  // "Show hidden" toggle on the contacts panel below — declared
  // BEFORE baseContacts because that memo references it inside its
  // filter callback (the callback fires during render, so the state
  // must be initialized first or we hit a temporal-dead-zone error).
  const [showHiddenContacts, setShowHiddenContacts] = useState(false);
  // Which service row has its SME editor open (service key, or null).
  const [expandedServiceSME, setExpandedServiceSME] = useState(null);

  // Indicative Savings analysis saved against this prospect from the
  // Utility Lookup page. Stored in a /analyses/main subcollection so
  // the bulk prospects query stays lean — fetched only when the modal
  // opens. null while loading or when no analysis has been saved.
  //
  // Only the metadata is subscribed to. The workbook itself is chunked
  // across sibling docs and can run to tens of megabytes for a large
  // portfolio; pulling that on every popup open just to render a filename
  // was what kept the save size capped. It's fetched on the download click.
  const [indicativeAnalysis, setIndicativeAnalysis] = useState(null);
  const [analysisDownloading, setAnalysisDownloading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  useEffect(() => {
    if (!prospect?.id || isNew) { setIndicativeAnalysis(null); return; }
    const unsub = subscribeIndicativeAnalysisMeta(prospect.id, (data) => setIndicativeAnalysis(data));
    return () => { if (unsub) unsub(); };
  }, [prospect?.id, isNew]);

  async function downloadIndicativeAnalysis() {
    if (!prospect?.id || analysisDownloading) return;
    setAnalysisDownloading(true);
    setAnalysisError('');
    try {
      const saved = await loadIndicativeAnalysis(prospect.id);
      if (!saved?.dataBase64) throw new Error('The saved analysis is empty: re-save it from Utility Lookup.');
      const binary = atob(saved.dataBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = saved.fileName || indicativeAnalysis?.fileName || 'Indicative Savings.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Indicative analysis download failed:', err);
      setAnalysisError(err?.message || 'Download failed.');
    } finally {
      setAnalysisDownloading(false);
    }
  }

  // Local contact state — updated optimistically after HubSpot saves
  const baseContacts = useMemo(() => {
    if (!fields.company || isNew) return [];
    // Collect this prospect's registered email domains so we can
    // include contacts whose Company text doesn't match the prospect
    // name but whose email sits on a known domain (e.g. "TIAA" vs
    // "(TIAA) Teachers Insurance and Annuity Association of America"
    // where every contact shares @tiaa.org).
    const domains = new Set();
    if (fields.emailDomain) {
      for (const entry of String(fields.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
        const at = entry.lastIndexOf('@');
        const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
        if (d) domains.add(d);
      }
    }
    if (fields.website) {
      const d = String(fields.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
      if (d) domains.add(d);
    }
    const FREE = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com']);
    const contactDomain = (email) => {
      if (!email) return '';
      const at = email.lastIndexOf('@');
      if (at < 0) return '';
      const d = email.slice(at + 1).toLowerCase().trim();
      return (d && !FREE.has(d)) ? d : '';
    };
    const matched = hubspotContacts
      .filter(c => {
        // The "Show hidden" toggle on the contacts panel below
        // flips this gate off so hide-tagged people resurface — the
        // user can then click into them to clear the tag.
        if (!showHiddenContacts && contactIsHidden(c)) return false;
        if (companiesMatch(c.company, fields.company)) return true;
        const d = contactDomain(c.email);
        if (d && domains.has(d)) {
          // Domain match only fills in contacts whose own Company text
          // is blank. A shared parent domain (e.g. blackstone.com)
          // otherwise drags every portfolio company's people onto each
          // entity's popup — a contact whose Company already reads
          // "Blackstone" shouldn't surface under "BRE Hotels & Resorts".
          // Contacts that genuinely belong here but carry a mismatched
          // Company text can still be pinned via "link" (companyContactLinks).
          if (!(c.company || '').trim()) return true;
        }
        return false;
      });
    // Explicitly linked contacts: ids the user associated with this
    // company on the popup (stored in settings.companyContactLinks).
    // They always appear — subject to the hidden toggle — even when the
    // contact's HubSpot Company text / email domain doesn't match, so
    // linking an existing contact sticks without a HubSpot refresh.
    const key = String(fields.company).trim().toLowerCase();
    const links = (settings.companyContactLinks || {})[key] || [];
    if (links.length) {
      const present = new Set(matched.map(c => String(c.id || c.vid)));
      const linkSet = new Set(links.map(String));
      for (const c of hubspotContacts) {
        const id = String(c.id || c.vid || '');
        if (!id || present.has(id) || !linkSet.has(id)) continue;
        if (!showHiddenContacts && contactIsHidden(c)) continue;
        matched.push(c);
        present.add(id);
      }
    }
    // Per-company exclusions: ids the user explicitly removed from this
    // company's roster (settings.companyContactExclusions) without
    // deleting them from HubSpot. They're dropped here so a shared-domain
    // or fuzzy-name false positive stays gone across syncs. The "Show
    // hidden" toggle surfaces them again so the user can re-add them.
    const exIds = new Set(((settings.companyContactExclusions || {})[key] || []).map(String));
    if (exIds.size) {
      if (showHiddenContacts) {
        const present = new Set(matched.map(c => String(c.id || c.vid)));
        for (const c of hubspotContacts) {
          const id = String(c.id || c.vid || '');
          if (id && exIds.has(id) && !present.has(id)) { matched.push(c); present.add(id); }
        }
      } else {
        return matched.filter(c => !exIds.has(String(c.id || c.vid || '')));
      }
    }
    return matched;
  }, [fields.company, fields.emailDomain, fields.website, hubspotContacts, isNew, showHiddenContacts, settings.companyContactLinks, settings.companyContactExclusions]);

  const [localContacts, setLocalContacts] = useState(baseContacts);
  useEffect(() => { setLocalContacts(baseContacts); }, [baseContacts]);
  // Mirror localContacts into a ref so handleContactSaved can tell a brand-
  // new association (a contact that wasn't already on this company) from an
  // edit to one already shown, without recreating the callback each render.
  const localContactsRef = useRef(localContacts);
  localContactsRef.current = localContacts;
  const companyContacts = localContacts;

  // Per-contact sent / received email counts sourced from the
  // hubspot-activity-cache localStorage entry that the Activity tab
  // populates. Counts dedupe by message id so a single email
  // associated to a contact via both ID and address only counts once.
  const emailCountsByContact = useMemo(() => {
    const out = new Map(); // contactKey -> { sent, received }
    if (!companyContacts || companyContacts.length === 0) return out;
    let raw;
    try { raw = JSON.parse(userLsGet('hubspot-activity-cache') || 'null'); } catch { raw = null; }
    const emails = raw?.emails || [];
    if (emails.length === 0) return out;

    const keyOf = (c) => `${c.id || c.vid || ''}|${(c.email || '').toLowerCase()}`;
    const byId = new Map();
    const byEmail = new Map();
    for (const c of companyContacts) {
      const k = keyOf(c);
      const id = String(c.id || c.vid || '');
      const email = (c.email || '').toLowerCase();
      if (id) byId.set(id, k);
      if (email) byEmail.set(email, k);
    }

    const sent = new Map();   // key -> Set<msgId>
    const received = new Map();
    for (const e of emails) {
      if ((e.hs_email_subject || '').toLowerCase().includes('(sample email)')) continue;
      const from = (e.hs_email_from_email || '').toLowerCase();
      const workEmail = (settings?.workEmail || '').toLowerCase();
      const direction = from.includes('@se.com') || (workEmail && from === workEmail)
        ? 'Outbound'
        : from ? 'Inbound' : (e.hs_email_direction || '');
      if (direction !== 'Outbound' && direction !== 'Inbound') continue;
      const msgId = e.id || e.hs_object_id || `${e.hs_timestamp || ''}|${e.hs_email_subject || ''}`;

      const matched = new Set();
      for (const id of e._contactIds || []) {
        const k = byId.get(String(id));
        if (k) matched.add(k);
      }
      if (direction === 'Outbound') {
        const recips = (e.hs_email_to_email || '').toLowerCase().split(/[;,]/).map(s => s.trim()).filter(Boolean);
        for (const r of recips) {
          const k = byEmail.get(r);
          if (k) matched.add(k);
        }
      } else if (from) {
        const k = byEmail.get(from);
        if (k) matched.add(k);
      }

      const target = direction === 'Outbound' ? sent : received;
      for (const k of matched) {
        let s = target.get(k);
        if (!s) { s = new Set(); target.set(k, s); }
        s.add(msgId);
      }
    }
    const allKeys = new Set([...sent.keys(), ...received.keys()]);
    for (const k of allKeys) {
      out.set(k, { sent: sent.get(k)?.size || 0, received: received.get(k)?.size || 0 });
    }
    return out;
  }, [companyContacts]);

  function getContactEmailCounts(c) {
    const k = `${c.id || c.vid || ''}|${(c.email || '').toLowerCase()}`;
    return emailCountsByContact.get(k) || { sent: 0, received: 0 };
  }

  function getContactSource(c) {
    // _source is stamped at creation; default to 'hubspot' for any
    // contact synced before this feature shipped.
    return c._source || 'hubspot';
  }

  // Build lookups from the uploaded Target Accounts sheets keyed by account name:
  //   repMap  — sales rep / owner
  //   tierMap — Tier 1 / Tier 2 / etc. (normalized to "Tier N" when possible)
  // Mirrors MyAccountsView's column-finding logic; prefers the first match per account.
  const [targetAccountRepMap, targetAccountTierMap] = useMemo(() => {
    const repMap = new Map();
    const tierMap = new Map();
    const data = targetAccountsData;
    if (!data?.sheets) return [repMap, tierMap];
    function findCol(r, keywords) {
      for (const key of Object.keys(r)) {
        const lower = (key || '').toLowerCase();
        for (const kw of keywords) {
          if (lower.includes(kw.toLowerCase())) return String(r[key] || '').trim();
        }
      }
      return '';
    }
    function normalizeTier(raw) {
      const s = (raw || '').trim();
      if (!s) return '';
      const m = s.match(/^(?:tier\s*)?(\d+)$/i);
      if (m) return `Tier ${m[1]}`;
      return s;
    }
    for (const sn of data.sheetNames || []) {
      const sheet = data.sheets[sn];
      if (!sheet?.records) continue;
      for (const rec of sheet.records) {
        const company = findCol(rec, ['Account Name', 'Company Name', 'Account', 'Company', 'Client Name', 'Client', 'Name']);
        if (!company) continue;
        const key = company.toLowerCase();
        // Use the salesperson/CDM column mapped on the Target Accounts
        // page (settings.targetCdmColumn), falling back to a keyword scan.
        const rep = resolveTargetAccountCdm(rec, settings?.targetCdmColumn);
        if (rep && !repMap.has(key)) repMap.set(key, rep);
        let tierRaw = findCol(rec, ['Account Tier', 'Tier Level', 'Tier']);
        if (!tierRaw) {
          tierRaw = Object.values(rec).find(v => /^tier\s*\d+$/i.test(String(v || '').trim())) || '';
        }
        const tier = normalizeTier(String(tierRaw));
        if (tier && !tierMap.has(key)) tierMap.set(key, tier);
      }
    }
    return [repMap, tierMap];
  }, [targetAccountsData, settings?.targetCdmColumn]);
  const repForTarget = useCallback((targetAccount) => {
    if (!targetAccount) return '';
    return targetAccountRepMap.get(targetAccount.toLowerCase()) || '';
  }, [targetAccountRepMap]);
  const tierForTarget = useCallback((targetAccount) => {
    if (!targetAccount) return '';
    return targetAccountTierMap.get(targetAccount.toLowerCase()) || '';
  }, [targetAccountTierMap]);

  // Collect all unique tags across all HubSpot contacts for the dropdown
  const allTagOptions = useMemo(() => {
    const tagSet = new Set();
    for (const c of hubspotContacts) {
      const raw = c.dans_tags || c.dan_s_tags || c.dans_tag || '';
      raw.split(';').map(t => t.trim()).filter(Boolean).forEach(t => {
        // Canonicalize on the spaced version "Efficiency / Renewables";
        // drop the no-space variant so we don't show both in the picker.
        if (t.toLowerCase().replace(/\s+/g, '') === 'efficiency/renewables') return;
        tagSet.add(t);
      });
    }
    // Always include the canonical bucket tags
    TAG_OPTIONS.forEach(t => tagSet.add(t));
    return [...tagSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [hubspotContacts]);

  // CDM options for the searchable dropdown, driven by the "CDM"
  // Dropdowns-tab list (managed on the Dropdowns page) unioned with the
  // names already in use — so the Dropdowns list is the source of truth.
  // The current value is always kept so an unsaved typed CDM still shows.
  const cdmOptions = useMemo(() => {
    const base = buildCdmOptions(prospects, settings);
    const cur = String(fields.cdm || '').trim();
    if (cur && !base.some(o => o.toLowerCase() === cur.toLowerCase())) return [...base, cur];
    return base;
  }, [prospects, settings, fields.cdm]);

  // Competitor name suggestions for the @-mention dropdown in the
  // notes editors. Harvested across every prospect's competitorsNotes
  // / serviceNotes / legacy competitors map (see harvestCompetitors)
  // so a name typed once on any record is suggested everywhere
  // afterwards.
  const competitorOptions = useMemo(() => harvestCompetitors(prospects), [prospects]);

  // Asset Types vocabulary, managed on the Dropdowns tab (plus any value
  // already in use), so the pop-up offers exactly what Table View does.
  const assetTypeOptions = useMemo(() => buildAssetTypeOptions(prospects, settings), [prospects, settings]);

  // Classification > Type, from the same Dropdowns-tab list — so a Type
  // added or renamed there shows up here, and a company keeps whatever
  // Type it already carries even if that one has since left the list.
  const typeOptions = useMemo(() => buildTypeOptions(prospects, settings), [prospects, settings]);

  // Company name (lowercased) → the tracker record's status, so the
  // Portfolio Companies Status column can show where a mapped company
  // already stands without the user re-entering it. First record wins on
  // a duplicate name; rows still fall back to a fuzzy companiesMatch scan
  // (see resolvePortfolioStatus) when the exact key misses.
  const prospectStatusByName = useMemo(() => {
    const m = new Map();
    for (const p of (prospects || [])) {
      const company = String(p?.company || '').trim();
      const status = String(p?.status || '').trim();
      if (!company || !status) continue;
      const key = company.toLowerCase();
      if (!m.has(key)) m.set(key, { company, status });
    }
    return m;
  }, [prospects]);

  // Company name → the tracker record itself, for the portfolio table's
  // open-company link. Statusless records are in here (see
  // findPortfolioProspect) and first writer wins, matching the status map
  // above so both resolve a duplicated name to the same record.
  const prospectByName = useMemo(() => {
    const m = new Map();
    for (const p of (prospects || [])) {
      const company = String(p?.company || '').trim();
      if (!company) continue;
      const key = company.toLowerCase();
      if (!m.has(key)) m.set(key, p);
    }
    return m;
  }, [prospects]);

  const [contactView, setContactView] = useState('table'); // 'table' | 'orgchart'
  // (showHiddenContacts state is declared earlier — above
  // baseContacts — so its useMemo can reference it without a TDZ.)
  // Number of hide-tagged contacts at this company / domain — drives
  // the badge on the "Show hidden" toggle. Memoized so the full
  // hubspotContacts walk only runs when the inputs actually change
  // (was previously inline in the JSX which made the modal freeze on
  // big-name accounts like URW).
  const hiddenContactsCount = useMemo(() => {
    const FREE_HIDDEN = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com']);
    const knownDomains = new Set();
    for (const entry of String(fields.emailDomain || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
      const at = entry.lastIndexOf('@');
      const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
      if (d && !FREE_HIDDEN.has(d)) knownDomains.add(d);
    }
    if (fields.website) {
      const d = String(fields.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
      if (d) knownDomains.add(d);
    }
    let n = 0;
    for (const c of (hubspotContacts || [])) {
      if (!contactIsHidden(c)) continue;
      if (companiesMatch(c.company, fields.company)) { n += 1; continue; }
      const email = String(c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      if (at < 0) continue;
      const d = email.slice(at + 1).trim();
      if (d && !FREE_HIDDEN.has(d) && knownDomains.has(d)) n += 1;
    }
    return n;
  }, [hubspotContacts, fields.company, fields.emailDomain, fields.website]);
  // Seed the contact editor when the modal was opened by clicking a specific
  // contact (e.g. a Decision Maker on the Pipeline renewals table).
  const [editingContact, setEditingContact] = useState(initialEditContact);
  const [addingContact, setAddingContact] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [deletingContact, setDeletingContact] = useState(null);
  const [bulkSelected, setBulkSelected] = useState(() => new Set()); // Set<cid string>
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkField, setBulkField] = useState('jobtitle');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkMode, setBulkMode] = useState('replace'); // 'replace' | 'append'
  const [servicesOpen, setServicesOpen] = useState(false);
  const [servicesEditMode, setServicesEditMode] = useState(false);
  const [editingServiceName, setEditingServiceName] = useState(null);
  const [expandedServiceNote, setExpandedServiceNote] = useState(null);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeQuery, setMergeQuery] = useState('');
  const [listsMatchOpen, setListsMatchOpen] = useState(false);
  const listsMatchBtnRef = useRef(null);
  // Fuzzy-match this company's name against the RA Clients list (Lists →
  // RA Clients tab). Surfaces a warning in the modal so the user doesn't
  // prospect a company that's already a live RA client. Uses the same
  // normalization + substring-ratio scoring the list tabs use, and reads
  // the effective list (user-uploaded override or bundled default).
  const raClientMatches = useMemo(() => {
    const company = (fields.company || '').trim();
    if (!company) return [];
    const target = normalizePortfolioCompany(company);
    if (!target) return [];
    const raClientsData = loadEffectiveRaClients().data || [];
    const seen = new Set();
    const out = [];
    for (const ra of raClientsData) {
      const name = raClientName(ra);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      const norm = normalizePortfolioCompany(name);
      if (!norm) continue;
      let score = 0;
      if (norm === target) score = 1;
      else if (norm.length >= 3 && target.length >= 3 && (norm.includes(target) || target.includes(norm))) {
        const shorter = Math.min(norm.length, target.length);
        const longer = Math.max(norm.length, target.length);
        score = longer > 0 ? shorter / longer : 0;
      }
      if (score >= 0.5) {
        seen.add(key);
        out.push({ name, cm: raClientCm(ra), score, exact: score === 1 });
      }
    }
    out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return out.slice(0, 5);
  }, [fields.company]);
  const [pastePortfolio, setPastePortfolio] = useState('');
  // Slug used as the Firestore path segment for persisted research
  // results — same shape as companySlug below; declared earlier here
  // so the sustainResearch state can read/write the saved blob.
  const sustainResearchSlug = useMemo(
    () => (fields.company || '').toLowerCase().replace(/[^a-z0-9]/g, '-'),
    [fields.company]
  );
  const [sustainResearch, setSustainResearch] = useState(() => {
    const saved = (settings?.companyResearch || {})[sustainResearchSlug];
    return { loading: false, data: saved || null, error: null };
  });
  // Re-hydrate when the modal switches companies (different slug) or
  // when a Firestore sync brings in fresh companyResearch data. Skip
  // the trample when a fetch is in flight.
  useEffect(() => {
    const saved = (settings?.companyResearch || {})[sustainResearchSlug];
    setSustainResearch(prev => {
      if (prev.loading) return prev;
      return { loading: false, data: saved || null, error: null };
    });
  }, [sustainResearchSlug, settings?.companyResearch]);
  const runSustainabilityResearch = useCallback(async () => {
    const company = (fields.company || '').trim();
    if (!company) return;
    setSustainResearch({ loading: true, data: null, error: null });
    try {
      const r = await apiFetch('/api/research-sustainability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company }),
      });
      if (!r.ok) {
        const txt = await r.text();
        let msg = `HTTP ${r.status}`;
        try { msg = JSON.parse(txt).error || msg; } catch { msg = txt.slice(0, 200) || msg; }
        setSustainResearch({ loading: false, data: null, error: msg });
        return;
      }
      const data = await r.json();
      const stamped = { ...data, savedAt: Date.now() };
      setSustainResearch({ loading: false, data: stamped, error: null });
      if (sustainResearchSlug) {
        updateSettingsPath({ [`companyResearch.${sustainResearchSlug}`]: stamped });
      }
    } catch (err) {
      setSustainResearch({ loading: false, data: null, error: err?.message || 'Request failed' });
    }
  }, [fields.company, sustainResearchSlug, updateSettingsPath]);
  const clearSustainResearch = useCallback(() => {
    setSustainResearch({ loading: false, data: null, error: null });
    if (sustainResearchSlug) {
      updateSettingsPath({ [`companyResearch.${sustainResearchSlug}`]: null });
    }
  }, [sustainResearchSlug, updateSettingsPath]);
  const [researchingPortfolio, setResearchingPortfolio] = useState(false);
  const [portfolioResearchError, setPortfolioResearchError] = useState(null);
  const [portfolioColWidths, setPortfolioColWidths] = useState({
    num: 30, company: 180, status: 130, industry: 140, sector: 160, subsector: 160, subsectorScore: 80, strategy: 140, hqCity: 130, hqCountry: 90, energy: 110, estElectricity: 120, estNaturalGas: 120, siteCount: 100, rank: 130, fitTier: 100, pcDescription: 260, acquisitionYear: 90, notes: 220, raClient: 200, clientManager: 140, targetAccount: 200, tier: 80, salesRep: 160, listFlags: 200,
  });
  // Per-column visibility for the Portfolio Companies table. Independent
  // from the export — the export header list is hard-coded so toggling
  // the on-screen view never drops columns from the downloaded sheet.
  const PORTFOLIO_COL_DEFS = useMemo(() => [
    { key: 'rank',             label: 'Opportunity Score' },
    { key: 'company',          label: 'Company' },
    { key: 'status',           label: 'Status' },
    { key: 'hqCity',           label: 'HQ City' },
    { key: 'hqCountry',        label: 'HQ Country' },
    { key: 'energy',           label: 'Energy' },
    { key: 'estElectricity',   label: 'Est. Electricity' },
    { key: 'estNaturalGas',    label: 'Est. Natural Gas' },
    { key: 'siteCount',        label: 'Sites' },
    { key: 'sector',           label: 'Sector' },
    { key: 'subsector',        label: 'Subsector' },
    { key: 'subsectorScore',   label: 'Subsector Score' },
    { key: 'strategy',         label: 'Strategy' },
    { key: 'acquisitionYear',  label: 'Acquisition Year' },
    { key: 'pcDescription',    label: 'PC Description' },
    { key: 'notes',            label: 'Notes' },
    { key: 'raClient',         label: 'RA Client Match' },
    { key: 'clientManager',    label: 'Client Manager' },
    { key: 'targetAccount',    label: 'Target Account' },
    { key: 'tier',             label: 'Tier' },
    { key: 'salesRep',         label: 'Other CDM' },
    { key: 'listFlags',        label: 'External Reporting' },
  ], []);
  const [portfolioColsVisible, setPortfolioColsVisible] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('portfolio-cols-visible'));
      if (saved && typeof saved === 'object') return saved;
    } catch { /* noop */ }
    // Default visibility — every column on except HQ City, which the
    // user keeps hidden by default and reveals via the Columns ▾ menu
    // when they need it.
    return Object.fromEntries(['rank','company','status','hqCity','hqCountry','energy','estElectricity','estNaturalGas','siteCount','sector','subsector','subsectorScore','strategy','acquisitionYear','pcDescription','notes','raClient','clientManager','targetAccount','tier','salesRep','listFlags'].map(k => [k, k !== 'hqCity']));
  });
  useEffect(() => {
    try { localStorage.setItem('portfolio-cols-visible', JSON.stringify(portfolioColsVisible)); } catch { /* noop */ }
  }, [portfolioColsVisible]);
  const [portfolioColsMenuOpen, setPortfolioColsMenuOpen] = useState(false);
  useEffect(() => {
    if (!portfolioColsMenuOpen) return;
    const h = e => {
      const t = e.target;
      if (t instanceof Element && t.closest('[data-portfolio-cols-menu]')) return;
      setPortfolioColsMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [portfolioColsMenuOpen]);
  const colVis = (key) => (portfolioColsVisible[key] === false ? 'collapse' : 'visible');
  const [portfolioSortByRank, setPortfolioSortByRank] = useState(true);
  const [raClientPickerOpen, setRaClientPickerOpen] = useState(null); // row index
  const [targetAccountPickerOpen, setTargetAccountPickerOpen] = useState(null); // row index
  const [peOwnerPickerOpen, setPeOwnerPickerOpen] = useState(false);
  const contactsImportRef = useRef(null);
  const [contactsDragging, setContactsDragging] = useState(false);
  const [contactsUploadPreview, setContactsUploadPreview] = useState(null); // { fileName, headers, rows, mapping }
  const [contactsImporting, setContactsImporting] = useState(false);
  const [refreshingHubspot, setRefreshingHubspot] = useState(false);
  const [refreshHubspotError, setRefreshHubspotError] = useState('');

  // Re-pull every HubSpot contact and overwrite the local cache, mirroring
  // the Contacts page's "Refresh contacts" button. setHubspotCache dispatches
  // `hubspot-cache-updated`, which App re-reads from IndexedDB and pushes back
  // down as the `hubspotContacts` prop — so this company's roster refreshes in
  // place without reopening the popup. Admin-only: the endpoint uses a single
  // server-side token tied to the admin portal.
  const refreshHubspotContacts = useCallback(async () => {
    if (refreshingHubspot || !isAdmin) return;
    setRefreshingHubspot(true);
    setRefreshHubspotError('');
    try {
      const res = await apiFetch('/api/hubspot?action=contacts');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.contacts) throw new Error('No contacts in response');
      const slimContacts = json.contacts.map(c => ({
        id: c.id, vid: c.vid, firstname: c.firstname, lastname: c.lastname,
        email: c.email, phone: c.phone, jobtitle: c.jobtitle, company: c.company,
        hs_linkedin_url: c.hs_linkedin_url, linkedin_url: c.linkedin_url, hs_linkedinid: c.hs_linkedinid,
        city: c.city, state: c.state, country: c.country,
        dans_tags: c.dans_tags, dan_s_tags: c.dan_s_tags, dans_tag: c.dans_tag,
        decision_maker: c.decision_maker, role: c.role,
        hs_sequences_is_enrolled: c.hs_sequences_is_enrolled,
        notes_last_contacted: c.notes_last_contacted,
      }));
      await setHubspotCachePreservingManual({ ...json, contacts: slimContacts, syncedAt: new Date().toISOString() });
    } catch (err) {
      setRefreshHubspotError(err?.message || 'Refresh failed');
    } finally {
      setRefreshingHubspot(false);
    }
  }, [refreshingHubspot, isAdmin]);

  // Set of lowercased-trimmed account names the user has blocked from
  // fuzzy-match suggestions on the Target Accounts page. The Portfolio
  // Companies suggestion list filters these out so a blocked account
  // (e.g. "ICE") never resurfaces here. Refreshed on the same event
  // TargetAccountsView dispatches when the user toggles a row.
  const [blockedTargetAccounts, setBlockedTargetAccounts] = useState(() => {
    try {
      const raw = userLsGet('target-accounts:blocked-names');
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.map(s => String(s).toLowerCase().trim()).filter(Boolean) : []);
    } catch { return new Set(); }
  });
  useEffect(() => {
    function refresh() {
      try {
        const raw = userLsGet('target-accounts:blocked-names');
        const arr = raw ? JSON.parse(raw) : [];
        setBlockedTargetAccounts(new Set(Array.isArray(arr) ? arr.map(s => String(s).toLowerCase().trim()).filter(Boolean) : []));
      } catch { setBlockedTargetAccounts(new Set()); }
    }
    function onStorage(e) { if (e.key && e.key.endsWith(':target-accounts:blocked-names')) refresh(); }
    window.addEventListener('target-accounts:blocked-changed', refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('target-accounts:blocked-changed', refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Close the PE Owner dropdown when clicking outside
  useEffect(() => {
    if (!peOwnerPickerOpen) return;
    const h = e => {
      const t = e.target;
      if (t instanceof Element && t.closest('[data-pe-picker]')) return;
      setPeOwnerPickerOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [peOwnerPickerOpen]);
  // Site List — a per-company spreadsheet of physical sites/locations the
  // user uploads. Stored under settings.companySiteLists[slug] (slug keyed
  // off the company name, same convention as companyOpportunities/Deals).
  // The Email Drafts page reads these back to build a combined Site List
  // Overview for every company that has a contact in the draft.
  const [siteListOpen, setSiteListOpen] = useState(false);
  const [siteListDragActive, setSiteListDragActive] = useState(false);
  const [siteListPasteOpen, setSiteListPasteOpen] = useState(false);
  const siteListInputRef = useRef(null);

  // Portfolio Companies upload preview — shows detected column mapping before applying
  const [portfolioUpload, setPortfolioUpload] = useState(null); // { fileName, headers: string[], rows: object[], mapping: { [header]: fieldKey|'' }, file?: File }
  const [portfolioDragActive, setPortfolioDragActive] = useState(false);
  // Bumped after save / clear so the source-file metadata is refetched
  // from IndexedDB. Also used as the key for the render-time cache below.
  const [portfolioSourceFileVersion, setPortfolioSourceFileVersion] = useState(0);
  const [portfolioSourceFile, setPortfolioSourceFile] = useState(null);

  // Source-file attachment helpers (per-parent-company, persisted in
  // IndexedDB so multi-MB Excel files don't blow the ~5 MB localStorage
  // cap. The IDB helper also migrates any legacy localStorage entry on
  // first load.)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rec = await loadPortfolioSourceFileFromIDB(fields.company);
      if (!cancelled) setPortfolioSourceFile(rec);
    })();
    return () => { cancelled = true; };
  }, [fields.company, portfolioSourceFileVersion]);

  function clearPortfolioSourceFile(companyName) {
    clearPortfolioSourceFileFromIDB(companyName).finally(() => {
      setPortfolioSourceFileVersion(v => v + 1);
    });
  }
  async function savePortfolioSourceFile(companyName, file) {
    try {
      await savePortfolioSourceFileToIDB(companyName, file);
      setPortfolioSourceFileVersion(v => v + 1);
    } catch (err) {
      if (err && err.name === 'QuotaExceededError') {
        alert('The data imported, but the source file was too large to keep as an attachment (browser storage cap).');
      } else {
        console.error('Failed to save source file attachment:', err);
      }
    }
  }

  // Shared file -> mapping-preview parser. Used by both the Upload Excel button
  // and the drag-and-drop handler on the Portfolio Companies section.
  // Slug used to key this company's site list in settings. Mirrors the
  // slugify in migrateCompanyData so renames carry the list along.
  const siteListSlug = (fields.company || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
  const currentSiteList = (settings.companySiteLists || {})[siteListSlug] || null;
  // Sq ft, divisions and property types across that list — the three
  // things a portfolio is read by, summarised above the table so they
  // don't have to be counted out of it by eye.
  const siteListFacts = useMemo(() => computeSiteListFacts(currentSiteList), [currentSiteList]);

  // Estimated annual value of a data deal for this company: its utility
  // accounts at $5 each per month, for twelve months. Null — shown as a
  // dash — until there is an account count to work from, since $0 would
  // read as a priced deal rather than an unanswered question.
  const estAnnualDataDeal = useMemo(() => {
    const accounts = Number(fields.numberOfAccounts);
    if (!Number.isFinite(accounts) || accounts <= 0) return null;
    return Math.round(accounts * DATA_DEAL_PER_ACCOUNT_MONTH * 12);
  }, [fields.numberOfAccounts]);

  // Parse an uploaded .xlsx/.xls/.csv into { headers, rows } and stash it
  // under settings.companySiteLists[slug]. Rows are plain header→cell
  // objects with Firestore-safe (string/number) values.
  const openSiteListFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      alert('Please upload an Excel or CSV file (.xlsx, .xls, or .csv).');
      return;
    }
    const slug = (fields.company || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
    if (!slug) { alert('Add a company name before uploading a site list.'); return; }
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!data.length) { alert('Uploaded file has no rows.'); return; }
      const safeCell = (v) => {
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString();
        if (typeof v === 'object') return String(v);
        return v;
      };
      // Union of headers across all rows so sparse columns aren't dropped.
      const headers = [];
      const seen = new Set();
      for (const r of data) {
        for (const h of Object.keys(r)) {
          if (!seen.has(h)) { seen.add(h); headers.push(h); }
        }
      }
      const rows = data.map(r => {
        const o = {};
        for (const h of headers) o[h] = safeCell(r[h]);
        return o;
      });
      updateSettingsPath({
        [`companySiteLists.${slug}`]: {
          company: fields.company || '',
          fileName: file.name,
          headers,
          rows,
          uploadedAt: new Date().toISOString(),
        },
      });
      setSiteListOpen(true);
    } catch (err) {
      alert('Failed to parse file: ' + (err.message || 'Unknown error'));
    }
  }, [fields.company, updateSettingsPath]);

  // Persist a site list built from the paste-and-map modal. `headers` is the
  // canonical column subset; `rows` are header→value objects.
  function saveSiteListFromPaste({ headers, rows }) {
    const slug = (fields.company || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
    if (!slug) { alert('Add a company name before adding a site list.'); return; }
    updateSettingsPath({
      [`companySiteLists.${slug}`]: {
        company: fields.company || '',
        fileName: 'Pasted from Excel',
        headers,
        rows,
        uploadedAt: new Date().toISOString(),
      },
    });
    setSiteListPasteOpen(false);
    setSiteListOpen(true);
  }

  function removeSiteList() {
    if (!siteListSlug) return;
    if (!window.confirm('Remove the uploaded site list for this company?')) return;
    updateSettingsPath({ [`companySiteLists.${siteListSlug}`]: null });
  }

  const openPortfolioMappingForFile = useCallback(async (file) => {
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!data.length) { alert('Uploaded file has no rows.'); return; }
      // Also read optional "Top 5 Overview" and "Top 5 Deep Dives" sheets so the user can
      // keep supporting research alongside the portfolio list and re-export all three together.
      function readAoaSheet(sheetName) {
        if (!sheetName) return null;
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
        if (!aoa.length) return null;
        const [headerRow, ...bodyRows] = aoa;
        // Firestore rejects nested arrays, so wrap each row's cells inside an
        // object. Also coerce Date/object values to strings since Firestore
        // can't round-trip arbitrary SheetJS cell types.
        function safeCell(v) {
          if (v == null) return '';
          if (v instanceof Date) return v.toISOString();
          if (typeof v === 'object') return String(v);
          return v;
        }
        return {
          sheetName,
          headers: headerRow.map(h => String(h ?? '')),
          rows: bodyRows.map(r => ({ cells: headerRow.map((_, i) => safeCell(r[i])) })),
        };
      }
      const overviewName = wb.SheetNames.find(n => /overview/i.test(n || ''));
      const deepDiveName = wb.SheetNames.find(n => /deep\s*dive/i.test(n || ''));
      // If the workbook just has a bare "Top 5" sheet (no overview/deep-dive qualifier),
      // treat it as the deep-dive tab to preserve the pre-existing behavior.
      const bareTop5Name = (!overviewName && !deepDiveName)
        ? wb.SheetNames.find(n => /top\s*5/i.test(n || ''))
        : null;
      const overview = readAoaSheet(overviewName);
      const topFive = readAoaSheet(deepDiveName || bareTop5Name);
      // Pull site count + estimated energy from the main Portfolio
      // Companies rows and splice them into the Overview's Multi-site
      // Billing and Energy cells.
      if (overview && Array.isArray(data) && data.length > 0) {
        enrichOverviewFromPortfolio(overview, data);
      }
      const headers = Object.keys(data[0]);
      const patterns = {
        companyName: ['companyname', 'company'],
        // Before the score patterns so "Status" can't be caught by anything
        // broader, and specific enough that "Subsector Score" stays put.
        status: ['status', 'stage', 'engagementstatus'],
        // Opportunity score before the fit-score patterns so a header literally
        // named "Opportunity Score" doesn't get swallowed by sectorScore.
        opportunityScore: ['opportunityscore', 'oppscore'],
        // Subsector before sector so a header literally named "Subsector Score"
        // wins over the broader "sector" / "score" patterns.
        subsectorScore: ['subsectorscore', 'subsectorfit', 'subsectorrating'],
        sectorScore: ['sectorscore', 'sectorfit', 'sectorrating', 'fitscore'],
        subsector: ['subsector'],
        // Industry and Sector are merged — both map to the sector field.
        sector: ['sector', 'industry'],
        hqCity: ['hqcity', 'city'],
        hqCountry: ['hqcountry', 'country'],
        estElectricity: ['estelectricity', 'estelectric', 'electricity', 'electric', 'kwh', 'mwh', 'powerusage', 'annualpower'],
        estNaturalGas: ['estnaturalgas', 'estnatgas', 'estgas', 'naturalgas', 'natgas', 'ngconsumption', 'therms', 'mmbtu', 'annualgas'],
        strategy: ['strategy', 'investmentstrategy', 'fundstrategy', 'peplaystrategy'],
        energyGwh: ['energy', 'gwh'],
        siteCount: ['sitecount', 'sites', 'numberofsites', 'estsitecount'],
        pcDescription: ['pcdescription', 'pcdesc', 'description'],
        acquisitionYear: ['acquisitionyear', 'acquired', 'yearacquired', 'acqyear'],
        notes: ['notes', 'note', 'comment', 'remarks'],
        raClientMatch: ['raclientmatch', 'raclient'],
        clientManager: ['clientmanager', 'manager'],
        targetAccount: ['targetaccount', 'target'],
        revenue: ['revenue', 'annualrevenue', 'companyrevenue', 'totalrevenue', 'sales', 'annualsales', 'topline'],
      };
      const mapping = {};
      const used = new Set();
      for (const h of headers) {
        const norm = (h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        let assigned = '';
        for (const [fieldKey, pats] of Object.entries(patterns)) {
          if (used.has(fieldKey)) continue;
          if (pats.some(p => norm.includes(p))) { assigned = fieldKey; used.add(fieldKey); break; }
        }
        mapping[h] = assigned;
      }
      setPortfolioUpload({ fileName: file.name, headers, rows: data, mapping, file, overview, topFive });
    } catch (err) {
      alert('Failed to parse file: ' + (err.message || 'Unknown error'));
    }
  }, []);
  const [raClientPickerQuery, setRaClientPickerQuery] = useState('');
  const [targetAccountPickerQuery, setTargetAccountPickerQuery] = useState('');
  // Reset the search query whenever a picker opens / closes / moves rows
  useEffect(() => { setRaClientPickerQuery(''); }, [raClientPickerOpen]);
  useEffect(() => { setTargetAccountPickerQuery(''); }, [targetAccountPickerOpen]);
  // Close any open picker when the user clicks outside of it
  useEffect(() => {
    if (raClientPickerOpen == null && targetAccountPickerOpen == null) return;
    function onDown(e) {
      const t = e.target;
      if (t instanceof Element && (t.closest('[data-picker="ra-client"]') || t.closest('[data-picker="target-account"]'))) return;
      setRaClientPickerOpen(null);
      setTargetAccountPickerOpen(null);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [raClientPickerOpen, targetAccountPickerOpen]);
  const [oppsCache, setOppsCache] = useState(null);
  const [clientManager, setClientManager] = useState(null);

  // Load opps data from IndexedDB (primary) or localStorage (legacy fallback)
  // Also load clients data to find Client Manager
  useEffect(() => {
    if (isNew) return;
    (async () => {
      // Opps 2 is the canonical opps store now — loadOppsFromIndexedDB
      // already routes through the Opps 2 cache, so the legacy
      // localStorage fallback (which only ever held Opps tab data) is
      // gone.
      const idbData = await loadOppsFromIndexedDB();
      if (idbData?.records) {
        setOppsCache(idbData.records);
      }
      // Client Manager: prefer the value assigned on the Clients page
      // (the shared clients-manager-map) so it auto-populates here when
      // the company is a tracked client. Fall back to the CM column on
      // the legacy clients-cache import only when nothing's assigned.
      if (fields.company) {
        const fromClientsPage = resolveClientManagerFromMap(fields.company);
        if (fromClientsPage) {
          setClientManager(fromClientsPage);
        } else {
          const clientsData = await loadClientsFromIndexedDB();
          if (clientsData?.records) {
            const match = clientsData.records.find(r => companiesMatch(r.Client || r.client, fields.company));
            if (match) setClientManager(match.CM || match.cm || null);
          }
        }
      }
    })();
  }, [isNew]);

  // Keep the Client Manager in sync if it's edited on the Clients page
  // while this modal is open.
  useEffect(() => {
    if (isNew || !fields.company) return undefined;
    function refresh() {
      const fromClientsPage = resolveClientManagerFromMap(fields.company);
      if (fromClientsPage) setClientManager(fromClientsPage);
    }
    window.addEventListener(CLIENT_MANAGER_EVENT, refresh);
    return () => window.removeEventListener(CLIENT_MANAGER_EVENT, refresh);
  }, [isNew, fields.company]);

  // The Client Manager is editable here as well as on the Clients page,
  // and both write the same per-company entry — so a name typed in either
  // place is the name in the other. Held as a draft and committed on blur
  // or Enter (the Clients page cell behaves the same way) rather than
  // saving each keystroke, which would write a partial name to shared
  // storage on the way to a whole one.
  const [cmDraft, setCmDraft] = useState('');
  useEffect(() => { setCmDraft(clientManager || ''); }, [clientManager]);

  // Escape restores the draft and blurs, but blur() runs its handler
  // before React has re-rendered — so a commit there still reads the
  // abandoned text and saves the very edit Escape just discarded. The
  // flag tells the blur that this one was cancelled.
  const cmCancelled = useRef(false);

  function commitClientManager() {
    if (cmCancelled.current) { cmCancelled.current = false; return; }
    const next = cmDraft.trim();
    if (next === (clientManager || '').trim()) return;
    if (!fields.company) return;
    saveClientManager(fields.company, next);
    // Clearing removes the assignment rather than storing a blank, so the
    // company falls back to the CM on the imported clients list if it has
    // one — the same "no override set" state it started in.
    setClientManager(next || null);
  }

  // Load opps scope+stage pairs matching this company
  const oppsRecords = useMemo(() => {
    if (isNew || !fields.company || !oppsCache) return [];
    return oppsCache
      .filter(r => companiesMatch(r.Account, fields.company))
      .filter(r => (r.Scope || '').trim())
      .map(r => ({ scope: (r.Scope || '').trim(), stage: (r.Stage || '').trim() }));
  }, [fields.company, isNew, oppsCache]);

  // Sales Partner suggestions: every partner name already used on an Opps 2
  // row, so a repeat partner is one click and spellings don't fragment. The
  // picker still takes free text, since a partner who has no opp yet won't
  // appear here.
  const salesPartnerOptions = useMemo(() => {
    const seen = new Map();
    for (const r of (oppsCache || [])) {
      const name = String(r?.['Sales Partner'] || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [oppsCache]);

  // Map service items to their opp stage (priority: Sold > active stages > Not Sold)
  const scopeMatchedServices = useMemo(() => {
    const stagePriority = { 'Sold': 4, 'Verbal': 3, 'Quoted': 3, 'Quoting': 2, 'Qualifying': 2, 'Lead': 1, 'Not Started': 1, 'Not Sold': 0 };
    const matched = new Map(); // item -> stage
    for (const { scope, stage } of oppsRecords) {
      for (const part of scopeTokens(scope)) {
        for (const cat of SERVICE_CATEGORIES) {
          for (const item of cat.items) {
            // Whole-word matching, shared with the Scope picker and the
            // Pipeline coverage table (src/utils/scopeMatch.js), so the
            // three boards can't disagree about what a Scope names.
            if (scopeTokenMatchesService(part, item)) {
              const existing = matched.get(item);
              const existingPri = existing ? (stagePriority[existing] ?? 1) : -1;
              const newPri = stagePriority[stage] ?? 1;
              if (newPri > existingPri) {
                matched.set(item, stage);
              }
            }
          }
        }
      }
    }
    return matched;
  }, [oppsRecords]);

  // Every service the board can show, in the user's own category layout —
  // the universe the scheduled-opp match below runs against.
  const allServiceItems = useMemo(() => {
    const cats = getServiceCategories(settings);
    return [...new Set(cats.flatMap(c => c.items || []))];
  }, [settings]);

  // Services this company has an opp QUEUED for — a New Opp scheduled for
  // a future date, which has no row on the Opps table yet and so matches
  // nothing above. Without this the board reads as untouched right up
  // until the opp fires, and the service looks free to book when someone
  // has already booked it.
  const scheduledServices = useMemo(() => {
    if (isNew || !fields.company) return new Map();
    return scheduledServicesForCompany(
      fields.company,
      normalizeScheduledOpps(settings.scheduledOpps),
      allServiceItems,
    );
  }, [isNew, fields.company, settings.scheduledOpps, allServiceItems]);

  // Pin a contact to this company so it always shows on the popup,
  // regardless of whether its HubSpot Company text matches. Persisted in
  // settings (Firestore) so the association survives reloads / syncs
  // without a HubSpot refresh.
  const linkContactToCompany = useCallback((contactId) => {
    const id = String(contactId || '');
    const key = String(fields.company || '').trim().toLowerCase();
    if (!id || !key) return;
    const cur = settings.companyContactLinks || {};
    const list = Array.isArray(cur[key]) ? cur[key] : [];
    if (list.map(String).includes(id)) return;
    updateSettings({ companyContactLinks: { ...cur, [key]: [...list, id] } });
  }, [fields.company, settings.companyContactLinks, updateSettings]);

  // Ids the user removed from THIS company's popup without deleting them
  // from HubSpot (settings.companyContactExclusions, keyed by company
  // name). baseContacts drops these; the row render uses the set to show
  // a "re-add" affordance for excluded contacts surfaced via "Show hidden".
  const excludedContactIds = useMemo(() => {
    const key = String(fields.company || '').trim().toLowerCase();
    return new Set(((settings.companyContactExclusions || {})[key] || []).map(String));
  }, [fields.company, settings.companyContactExclusions]);

  // Remove a contact from this company's roster only. Non-destructive —
  // the contact stays in HubSpot and on every other company it matches.
  const excludeContactFromCompany = useCallback((contactId) => {
    const id = String(contactId || '');
    const key = String(fields.company || '').trim().toLowerCase();
    if (!id || !key) return;
    const cur = settings.companyContactExclusions || {};
    const list = Array.isArray(cur[key]) ? cur[key].map(String) : [];
    if (list.includes(id)) return;
    updateSettings({ companyContactExclusions: { ...cur, [key]: [...list, id] } });
  }, [fields.company, settings.companyContactExclusions, updateSettings]);

  // Undo an exclusion so the contact can match this company again.
  const unexcludeContactFromCompany = useCallback((contactId) => {
    const id = String(contactId || '');
    const key = String(fields.company || '').trim().toLowerCase();
    if (!id || !key) return;
    const cur = settings.companyContactExclusions || {};
    const list = Array.isArray(cur[key]) ? cur[key].map(String) : [];
    if (!list.includes(id)) return;
    const nextList = list.filter(x => x !== id);
    const next = { ...cur };
    if (nextList.length) next[key] = nextList; else delete next[key];
    updateSettings({ companyContactExclusions: next });
  }, [fields.company, settings.companyContactExclusions, updateSettings]);

  const handleContactSaved = useCallback((updated, options = {}) => {
    const updatedId = String(updated.id || updated.vid || '');
    // A contact not already on this company's roster is a fresh
    // association — remember it so it sticks without a HubSpot refresh.
    const wasPresent = localContactsRef.current.some(c => String(c.id || c.vid) === updatedId);
    setLocalContacts(prev => {
      const existing = prev.find(c => String(c.id || c.vid) === updatedId);
      if (existing) {
        return prev.map(c => (String(c.id || c.vid) === updatedId ? { ...c, ...updated } : c));
      }
      return [...prev, updated];
    });
    if (!wasPresent && updatedId) linkContactToCompany(updatedId);
    if (options.silent) return; // e.g. inline autosaves shouldn't close the modal
    setAddingContact(false);
    setEditingContact(null);
  }, [linkContactToCompany]);

  const handleSaveContactNote = useCallback((contactId, note) => {
    const current = settings.contactNotes || {};
    const next = { ...current };
    if (note && note.trim()) next[contactId] = note;
    else delete next[contactId];
    updateSettings({ contactNotes: next });
  }, [settings.contactNotes, updateSettings]);

  const handleSaveContactOldEmails = useCallback((contactId, oldEmails) => {
    const current = settings.contactOldEmails || {};
    const next = { ...current };
    if (oldEmails && oldEmails.trim()) next[contactId] = oldEmails;
    else delete next[contactId];
    updateSettings({ contactOldEmails: next });
  }, [settings.contactOldEmails, updateSettings]);

  const handleSaveContactOldCompany = useCallback((contactId, oldCompany) => {
    const current = settings.contactOldCompany || {};
    const next = { ...current };
    if (oldCompany && oldCompany.trim()) next[contactId] = oldCompany;
    else delete next[contactId];
    updateSettings({ contactOldCompany: next });
  }, [settings.contactOldCompany, updateSettings]);

  const handleSaveContactNickname = useCallback((contactId, nickname) => {
    const current = settings.contactNicknames || {};
    const next = { ...current };
    if (nickname && nickname.trim()) next[contactId] = nickname;
    else delete next[contactId];
    updateSettings({ contactNicknames: next });
  }, [settings.contactNicknames, updateSettings]);

  const handleSaveContactTeamName = useCallback((contactId, teamName) => {
    const current = settings.contactTeamNames || {};
    const next = { ...current };
    if (teamName && teamName.trim()) next[contactId] = teamName.trim();
    else delete next[contactId];
    updateSettings({ contactTeamNames: next });
  }, [settings.contactTeamNames, updateSettings]);

  // "Met In Person" is stored locally (never in HubSpot). Persist the
  // explicit true/false so unchecking a contact that still carries the
  // legacy HubSpot tag sticks instead of falling back to "checked".
  const handleSaveContactMetInPerson = useCallback((contactId, met) => {
    const current = settings.contactMetInPerson || {};
    const next = { ...current, [contactId]: !!met };
    updateSettings({ contactMetInPerson: next });
  }, [settings.contactMetInPerson, updateSettings]);

  const handleSaveContactInvitedToLouisville = useCallback((contactId, invited) => {
    const current = settings.contactInvitedToLouisville || {};
    const next = { ...current, [contactId]: !!invited };
    updateSettings({ contactInvitedToLouisville: next });
  }, [settings.contactInvitedToLouisville, updateSettings]);

  // Champion / detractor. Neutral removes the key rather than storing an
  // empty string, so the map only carries contacts anyone has judged.
  const handleSaveContactSentiment = useCallback((contactId, value) => {
    const current = settings.contactSentiment || {};
    const next = { ...current };
    if (value) next[contactId] = value; else delete next[contactId];
    updateSettings({ contactSentiment: next });
  }, [settings.contactSentiment, updateSettings]);

  const handleSaveContactReportsTo = useCallback((contactId, managerIds) => {
    const current = settings.contactReportsTo || {};
    const next = { ...current };
    const arr = Array.isArray(managerIds)
      ? managerIds.filter(Boolean).map(String)
      : (managerIds ? [String(managerIds)] : []);
    if (arr.length > 0) next[contactId] = arr;
    else delete next[contactId];
    updateSettings({ contactReportsTo: next });
  }, [settings.contactReportsTo, updateSettings]);
  // Load an Excel file and show the column-mapping preview modal; don't import yet.
  const processContactsFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.xlsx?$/i.test(file.name)) { alert('Please drop an Excel file (.xlsx or .xls).'); return; }
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) { alert('The uploaded file has no rows.'); return; }
      const headers = Object.keys(rows[0]);
      const norm = s => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
      const mapping = {};
      for (const h of headers) {
        const n = norm(h);
        if (n === 'firstname' || n === 'first') mapping[h] = 'firstname';
        else if (n === 'lastname' || n === 'last') mapping[h] = 'lastname';
        else if (n === 'jobtitle' || n === 'title') mapping[h] = 'jobtitle';
        else if (n === 'teamname' || n === 'team') mapping[h] = 'teamName';
        else if (n === 'email') mapping[h] = 'email';
        else if (n === 'phone') mapping[h] = 'phone';
        else if (n === 'city') mapping[h] = 'city';
        else if (n === 'state') mapping[h] = 'state';
        else if (n === 'country') mapping[h] = 'country';
        else if (n === 'linkedin' || n === 'linkedinurl') mapping[h] = 'linkedin';
        else if (n === 'tags' || n === 'danstags') mapping[h] = 'dans_tags';
        else if (n === 'notes' || n === 'note') mapping[h] = 'notes';
        else mapping[h] = '';
      }
      setContactsUploadPreview({ fileName: file.name, headers, rows, mapping });
    } catch (err) {
      alert('Failed to read file: ' + (err.message || err));
    }
  }, []);

  // Run the actual delete+create import with the user-confirmed mapping.
  const confirmContactsImport = useCallback(async () => {
    const preview = contactsUploadPreview;
    if (!preview) return;
    const { rows, mapping } = preview;
    const parsed = rows
      .map(r => {
        const out = { company: fields.company };
        for (const [src, dst] of Object.entries(mapping)) {
          if (!dst) continue;
          const v = String(r[src] ?? '').trim();
          if (dst === 'linkedin') out.hs_linkedin_url = v;
          else out[dst] = v;
        }
        return out;
      })
      .filter(r => r.email);
    if (parsed.length === 0) { alert('No rows had a mapped Email: nothing to import.'); return; }
    const existingToDelete = companyContacts.filter(c => c.id || c.vid);
    const confirmMsg = existingToDelete.length > 0
      ? `This will REPLACE the contacts under ${fields.company}.\n\n` +
        `• ${existingToDelete.length} existing contact${existingToDelete.length === 1 ? '' : 's'} will be DELETED from HubSpot.\n` +
        `• ${parsed.length} contact${parsed.length === 1 ? '' : 's'} from the file will be CREATED.\n\n` +
        `This cannot be undone. Continue?`
      : `Import ${parsed.length} contact${parsed.length === 1 ? '' : 's'} into HubSpot under ${fields.company}?`;
    if (!window.confirm(confirmMsg)) return;

    setContactsImporting(true);
    let deleted = 0, deleteErrors = 0;
    for (const c of existingToDelete) {
      const cid = c.id || c.vid;
      try {
        const res = await apiFetch('/api/hubspot?action=delete-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: cid }),
        });
        const data = await res.json();
        if (data.success) {
          deleted += 1;
          try {
            await updateHubspotCache(draft => {
              draft.contacts = draft.contacts.filter(x => String(x.id || x.vid) !== String(cid));
            });
          } catch { /* ignore */ }
        } else {
          deleteErrors += 1;
        }
      } catch {
        deleteErrors += 1;
      }
    }

    let added = 0, errors = 0;
    for (const row of parsed) {
      const { teamName, notes: noteText, ...hsProps } = row;
      try {
        const res = await apiFetch('/api/hubspot?action=create-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ properties: hsProps }),
        });
        const data = await res.json();
        if (data.success && data.contact) {
          added += 1;
          try {
            await updateHubspotCache(draft => { draft.contacts.push(data.contact); });
          } catch { /* ignore */ }
          const newId = data.contact.id;
          if (newId && teamName) handleSaveContactTeamName(newId, teamName);
          if (newId && noteText) handleSaveContactNote(newId, noteText);
        } else {
          errors += 1;
        }
      } catch {
        errors += 1;
      }
    }
    notifyCacheUpdated();
    setContactsImporting(false);
    setContactsUploadPreview(null);
    alert(
      `Deleted ${deleted} existing contact${deleted === 1 ? '' : 's'}${deleteErrors > 0 ? ` (${deleteErrors} failed to delete)` : ''}.\n` +
      `Imported ${added} new contact${added === 1 ? '' : 's'}${errors > 0 ? ` (${errors} failed)` : ''}.`
    );
  }, [contactsUploadPreview, fields.company, companyContacts, handleSaveContactTeamName, handleSaveContactNote]);


  const handleCloseContactEdit = useCallback(() => {
    setEditingContact(null);
    setAddingContact(false);
  }, []);

  // Per-company slug used by the Opportunities section below.
  const companySlug = useMemo(
    () => (fields.company || '').toLowerCase().replace(/[^a-z0-9]/g, '-'),
    [fields.company]
  );

  // ── Notes (per-company, synced via userSettings) ──
  // Shape: settings.companyOpportunities[slug] = { buckets: [{id,name}], opportunities: [{id,bucketId,title,notes,createdAt,updatedAt}] }
  // (Legacy storage key; the UI label is "Notes" but the underlying data model is unchanged.)
  const companyOppsData = (settings.companyOpportunities || {})[companySlug] || { buckets: [], opportunities: [] };
  // Notes section starts expanded so the per-company note pages are
  // visible by default when a company popup opens.
  const [opportunitiesOpen, setOpportunitiesOpen] = useState(true);
  const [selectedOppId, setSelectedOppId] = useState(null);
  // ID of the form tab currently in inline-rename mode. The tab strip
  // swaps the title span out for an <input> when this matches.
  const [renamingOppId, setRenamingOppId] = useState(null);
  const [oppNoteDraft, setOppNoteDraft] = useState('');
  const oppSaveTimerRef = useRef(null);
  const oppSlugRef = useRef(companySlug);

  // Clear selection / draft when switching company
  useEffect(() => {
    if (oppSlugRef.current !== companySlug) {
      oppSlugRef.current = companySlug;
      setSelectedOppId(null);
      setOppNoteDraft('');
    }
  }, [companySlug]);

  useEffect(() => () => {
    if (oppSaveTimerRef.current) clearTimeout(oppSaveTimerRef.current);
  }, []);

  const selectedOpp = useMemo(
    () => (companyOppsData.opportunities || []).find(o => o.id === selectedOppId) || null,
    [companyOppsData.opportunities, selectedOppId]
  );

  // Other form-type notes for this company — used to power the "Import
  // … from another note" pickers (Key Issues, Call Context, etc.) in the
  // active note's OpportunityForm. We carry payloads for every supported
  // section here so the form can decide what to surface per picker.
  const importableNotes = useMemo(() => {
    if (!selectedOppId) return [];
    const t = (DEFAULT_FORM_TEMPLATE.tables || []).find(x => x.key === 'meetingNotes');
    const cols = t?.columns || [];
    const isEmptyRow = (r) => {
      if (!r) return true;
      for (const c of cols) if ((r[c.key] || '').toString().trim()) return false;
      return true;
    };
    return (companyOppsData.opportunities || [])
      .filter(o => o.type === 'form' && o.id !== selectedOppId)
      .map(o => {
        const rows = (o.formData?.tables?.meetingNotes || []).filter(r => !isEmptyRow(r));
        const context = (o.formData?.fieldValues?.context || '').toString();
        return {
          id: o.id,
          title: o.title || 'Untitled',
          updatedAt: o.updatedAt || 0,
          rows,
          rowsCount: rows.length,
          context,
        };
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [companyOppsData.opportunities, selectedOppId]);

  // When selection changes, load its notes into the draft (flush any pending save first)
  useEffect(() => {
    if (oppSaveTimerRef.current) { clearTimeout(oppSaveTimerRef.current); oppSaveTimerRef.current = null; }
    setOppNoteDraft(selectedOpp ? (selectedOpp.notes || '') : '');
  }, [selectedOppId]); // eslint-disable-line react-hooks/exhaustive-deps

  const writeCompanyOpps = useCallback((nextData) => {
    if (!companySlug) return;
    const isEmpty = (!nextData.buckets || nextData.buckets.length === 0) && (!nextData.opportunities || nextData.opportunities.length === 0);
    // Path-based write so other devices editing other companies don't get overwritten.
    updateSettingsPath({ [`companyOpportunities.${companySlug}`]: isEmpty ? null : nextData });
  }, [companySlug, updateSettingsPath]);

  const addBucket = useCallback(() => {
    const bucket = { id: `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: '' };
    writeCompanyOpps({
      buckets: [...(companyOppsData.buckets || []), bucket],
      opportunities: companyOppsData.opportunities || [],
    });
  }, [companyOppsData, writeCompanyOpps]);

  const renameBucketTo = useCallback((bucketId, name) => {
    writeCompanyOpps({
      buckets: (companyOppsData.buckets || []).map(b => b.id === bucketId ? { ...b, name } : b),
      opportunities: companyOppsData.opportunities || [],
    });
  }, [companyOppsData, writeCompanyOpps]);

  const renameBucket = useCallback((bucketId) => {
    const current = (companyOppsData.buckets || []).find(b => b.id === bucketId);
    if (!current) return;
    const name = window.prompt('Rename bucket:', current.name);
    if (name == null || name.trim() === current.name) return;
    writeCompanyOpps({
      buckets: (companyOppsData.buckets || []).map(b => b.id === bucketId ? { ...b, name: name.trim() } : b),
      opportunities: companyOppsData.opportunities || [],
    });
  }, [companyOppsData, writeCompanyOpps]);

  const deleteBucket = useCallback((bucketId) => {
    const bucket = (companyOppsData.buckets || []).find(b => b.id === bucketId);
    if (!bucket) return;
    const count = (companyOppsData.opportunities || []).filter(o => o.bucketId === bucketId).length;
    const msg = count > 0
      ? `Delete bucket "${bucket.name}" and its ${count} opportunit${count === 1 ? 'y' : 'ies'}?`
      : `Delete bucket "${bucket.name}"?`;
    if (!window.confirm(msg)) return;
    const nextOpps = (companyOppsData.opportunities || []).filter(o => o.bucketId !== bucketId);
    if (selectedOppId && !nextOpps.find(o => o.id === selectedOppId)) setSelectedOppId(null);
    writeCompanyOpps({
      buckets: (companyOppsData.buckets || []).filter(b => b.id !== bucketId),
      opportunities: nextOpps,
    });
  }, [companyOppsData, selectedOppId, writeCompanyOpps]);

  const customOpportunityTemplate = settings.opportunityTemplate || '';

  const applyDateStampToTemplate = useCallback((templateHtml, dateLine, timeLine) => {
    // Replace any existing "<em>… · …</em>" first paragraph or prepend a fresh stamp.
    const stamp = `<p><em>${dateLine} · ${timeLine}</em></p>`;
    if (/^<p><em>[^<]+·[^<]+<\/em><\/p>/i.test(templateHtml.trim())) {
      return templateHtml.trim().replace(/^<p><em>[^<]+·[^<]+<\/em><\/p>/i, stamp);
    }
    return stamp + templateHtml;
  }, []);

  const getEffectiveTemplate = useCallback((dateLine, timeLine) => {
    if (customOpportunityTemplate && customOpportunityTemplate.replace(/<[^>]*>/g, '').trim()) {
      return applyDateStampToTemplate(customOpportunityTemplate, dateLine, timeLine);
    }
    return buildDefaultOpportunityTemplate(dateLine, timeLine);
  }, [customOpportunityTemplate, applyDateStampToTemplate]);

  const downloadOpportunityTemplate = useCallback(async () => {
    const d = new Date();
    const dateLine = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const timeLine = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    let bodyHtml = getEffectiveTemplate(dateLine, timeLine);
    // For Word output, replace Quill checklist items (<li data-list="checked|unchecked">X</li>)
    // with plain paragraphs that use inline ☑/☐ characters. Word doesn't understand
    // Quill's checklist attribute and would otherwise render them as a bulleted list.
    bodyHtml = bodyHtml
      .replace(/<li\s+data-list="checked">([^<]+)<\/li>/g, '<p>☑ $1</p>')
      .replace(/<li\s+data-list="unchecked">([^<]+)<\/li>/g, '<p>☐ $1</p>')
      .replace(/<ol>(\s*(?:<p>[☑☐][^<]*<\/p>\s*)+)<\/ol>/g, '$1');
    const fullHtml = stripDashes(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Opportunity Template</title></head><body><h1>Opportunity Template</h1>${bodyHtml}</body></html>`);
    try {
      const { asBlob: htmlToDocxBlob } = await import('html-docx-js-typescript');
      const result = await htmlToDocxBlob(fullHtml);
      const blob = result instanceof Blob ? result : new Blob([result], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Opportunity Template.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert('Failed to export template: ' + (err.message || err));
    }
  }, [getEffectiveTemplate]);

  const templateFileInputRef = useRef(null);
  const handleTemplateUpload = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { alert('Please choose a .docx file.'); return; }
    try {
      const { default: mammoth } = await import('mammoth/mammoth.browser');
      const buf = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer: buf });
      let html = result.value || '';
      // Strip the "Opportunity Template" H1 we add on export, if present.
      html = html.replace(/^\s*<h1>[^<]*Opportunity\s+Template[^<]*<\/h1>\s*/i, '');
      if (!html.replace(/<[^>]*>/g, '').trim()) { alert('The uploaded document appears to be empty.'); return; }
      updateSettings({ opportunityTemplate: html });
      alert('Template updated. New opportunities will use this template.');
    } catch (err) {
      alert('Failed to read Word document: ' + (err.message || err));
    }
  }, [updateSettings]);

  const resetOpportunityTemplate = useCallback(() => {
    if (!window.confirm('Reset the opportunity template to the built-in default?')) return;
    updateSettings({ opportunityTemplate: '' });
  }, [updateSettings]);

  const addOpportunity = useCallback((bucketId) => {
    const title = window.prompt('Opportunity title:');
    if (!title || !title.trim()) return;
    const now = Date.now();
    const d = new Date();
    const dateLine = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const timeLine = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const notes = getEffectiveTemplate(dateLine, timeLine);
    const opp = { id: `o_${now}_${Math.random().toString(36).slice(2, 7)}`, bucketId, title: title.trim(), notes, createdAt: now, updatedAt: now };
    writeCompanyOpps({
      buckets: companyOppsData.buckets || [],
      opportunities: [...(companyOppsData.opportunities || []), opp],
    });
    setSelectedOppId(opp.id);
  }, [companyOppsData, writeCompanyOpps, getEffectiveTemplate]);

  const addOpportunityForm = useCallback((bucketId) => {
    const now = Date.now();
    const opp = {
      id: `o_${now}_${Math.random().toString(36).slice(2, 7)}`,
      bucketId: bucketId || null,
      title: 'New form',
      titleAuto: true,
      type: 'form',
      formData: null,
      createdAt: now,
      updatedAt: now,
    };
    writeCompanyOpps({
      buckets: companyOppsData.buckets || [],
      opportunities: [...(companyOppsData.opportunities || []), opp],
    });
    setSelectedOppId(opp.id);
    setOpportunitiesOpen(true);
    // Immediately drop the user into the inline rename input on the
    // freshly-created tab — saves them an extra click.
    setRenamingOppId(opp.id);
  }, [companyOppsData, writeCompanyOpps]);

  const updateOpportunityFormData = useCallback((oppId, formData) => {
    writeCompanyOpps({
      buckets: companyOppsData.buckets || [],
      opportunities: (companyOppsData.opportunities || []).map(o =>
        o.id === oppId ? { ...o, formData, updatedAt: Date.now() } : o
      ),
    });
  }, [companyOppsData, writeCompanyOpps]);


  // Switch the given form tab into inline-rename mode. The actual
  // commit happens in commitOppRename when the user blurs / hits Enter
  // on the in-place input.
  const renameOpportunity = useCallback((oppId) => {
    setRenamingOppId(oppId);
  }, []);

  // Write the new title typed into the inline input. Skip the write
  // when the title is unchanged or blank — that lets the user cancel a
  // rename by clearing the field and pressing Enter without ending up
  // with an empty tab.
  const commitOppRename = useCallback((oppId, rawTitle) => {
    setRenamingOppId(null);
    const next = String(rawTitle ?? '').trim();
    if (!next) return;
    const current = (companyOppsData.opportunities || []).find(o => o.id === oppId);
    if (!current || current.title === next) return;
    writeCompanyOpps({
      buckets: companyOppsData.buckets || [],
      opportunities: (companyOppsData.opportunities || []).map(o => o.id === oppId ? { ...o, title: next, titleAuto: false, updatedAt: Date.now() } : o),
    });
  }, [companyOppsData, writeCompanyOpps]);

  const cancelOppRename = useCallback(() => setRenamingOppId(null), []);

  const deleteOpportunity = useCallback((oppId) => {
    const opp = (companyOppsData.opportunities || []).find(o => o.id === oppId);
    if (!opp) return;
    if (!window.confirm(`Delete opportunity "${opp.title}"? This cannot be undone.`)) return;
    if (selectedOppId === oppId) setSelectedOppId(null);
    writeCompanyOpps({
      buckets: companyOppsData.buckets || [],
      opportunities: (companyOppsData.opportunities || []).filter(o => o.id !== oppId),
    });
  }, [companyOppsData, selectedOppId, writeCompanyOpps]);

  const moveOpportunity = useCallback((oppId, newBucketId) => {
    writeCompanyOpps({
      buckets: companyOppsData.buckets || [],
      opportunities: (companyOppsData.opportunities || []).map(o => o.id === oppId ? { ...o, bucketId: newBucketId, updatedAt: Date.now() } : o),
    });
  }, [companyOppsData, writeCompanyOpps]);

  const handleOppNoteChange = useCallback((html) => {
    setOppNoteDraft(html);
    if (!selectedOppId) return;
    if (oppSaveTimerRef.current) clearTimeout(oppSaveTimerRef.current);
    const idAtEdit = selectedOppId;
    oppSaveTimerRef.current = setTimeout(() => {
      const data = (settings.companyOpportunities || {})[companySlug] || { buckets: [], opportunities: [] };
      const nextOpps = (data.opportunities || []).map(o => o.id === idAtEdit ? { ...o, notes: html, updatedAt: Date.now() } : o);
      updateSettingsPath({ [`companyOpportunities.${companySlug}`]: { buckets: data.buckets || [], opportunities: nextOpps } });
    }, 800);
  }, [companySlug, selectedOppId, settings.companyOpportunities, updateSettingsPath]);

  // ── Opportunity Word (.docx) import / export ──
  const oppDocxInputRef = useRef(null);
  const oppQuillRef = useRef(null);

  // Generate a follow-up email and download it as an .eml file (matches the Draft Emails
  // section pattern — double-click the downloaded file to open as a draft in Outlook).
  const openOppFollowUpEmail = useCallback(() => {
    if (!selectedOpp) return;
    // Source follow-up items from the Form's "Action Items / Next Steps"
    // table (rows with a non-empty `item`). Each row's Owner is shown in
    // parens after the action so the reader sees who's on the hook.
    // Pull Action Items / Next Steps rows. Fall back across possible keys
    // (item/text/action/description/title) so a legacy row shape still
    // surfaces content instead of silently being filtered out.
    const actionTables = selectedOpp?.formData?.tables || {};
    const actionRows = Array.isArray(actionTables.actionItems)
      ? actionTables.actionItems
      : (Array.isArray(actionTables.nextSteps) ? actionTables.nextSteps : []);
    const pickText = (r) => String(r?.item ?? r?.text ?? r?.action ?? r?.description ?? r?.title ?? '').trim();
    const pickOwner = (r) => String(r?.owner ?? r?.assignee ?? r?.who ?? '').trim();
    const items = actionRows
      .map(r => ({ text: pickText(r), owner: pickOwner(r) }))
      .filter(i => i.text);

    // Recipients: reply-all behavior — union of the opportunity's linked
    // contacts and everyone on the imported meeting (organizer + ICS
    // attendees + manual additions), deduped by lowercased email.
    const linkedIds = new Set((selectedOpp.contactIds || []).map(String));
    const recipientMap = new Map();
    const addEmail = (email) => {
      const e = String(email || '').trim();
      if (!e) return;
      const key = e.toLowerCase();
      if (!recipientMap.has(key)) recipientMap.set(key, e);
    };
    (companyContacts || [])
      .filter(c => linkedIds.has(String(c.id || c.vid)))
      .forEach(c => addEmail(c.email));
    const meeting = selectedOpp?.formData?.meeting;
    if (meeting) {
      if (meeting.organizer?.email) addEmail(meeting.organizer.email);
      for (const a of (meeting.attendees || [])) addEmail(a?.email);
      for (const a of (meeting.manualAttendees || [])) addEmail(a?.email);
    }
    const recipients = [...recipientMap.values()];

    // Subject mirrors a reply-all to the original meeting when one is
    // attached; otherwise we fall back to the company/opp title.
    const meetingSubject = String(meeting?.subject || '').trim();
    const titleBit = selectedOpp.title ? `: ${selectedOpp.title}` : '';
    const subject = meetingSubject
      ? (/^re:\s/i.test(meetingSubject) ? meetingSubject : `Re: ${meetingSubject}`)
      : `Follow-up: ${fields.company || 'our conversation'}${titleBit}`;

    // Build the HTML body — bulleted list for the to-do items.
    const esc = s => String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const introLine = `Thanks again for the conversation${fields.company ? ` about ${esc(fields.company)}` : ''}${selectedOpp.title ? ` (${esc(selectedOpp.title)})` : ''}. Below is a recap of the follow-up items:`;
    // Outlook's .eml → draft workflow strips <ul>/<li> styling when
    // converting the HTML into its internal compose format, so bullets
    // disappear even though the source markup is correct. Render each
    // action item as a standalone <div> with a literal bullet character
    // so Outlook always shows it regardless of list-style handling.
    const itemsHtml = items.length > 0
      ? items.map(i => `<div style="margin: 4px 0; line-height: 1.45;">&#8226;&nbsp;&nbsp;${esc(i.text)}${i.owner ? ` &middot; <span style="color:#64748B;"><strong>Owner:</strong> ${esc(i.owner)}</span>` : ''}</div>`).join('')
      : '<p><em>(No Action Items / Next Steps captured on the form yet.)</em></p>';
    // Append the saved email signature (from the Draft Emails page /
    // settings.emailSignature). The bundled default is the admin's
    // personal signature, so only fall back to it for the admin
    // account — other users get no signature until they save one.
    const storedSig = String(settings?.emailSignature || '').trim();
    const signatureHtml = storedSig || (isAdmin ? DEFAULT_EMAIL_SIGNATURE : '');
    const sigBlock = signatureHtml ? `\n<br>\n<div>\n${signatureHtml}\n</div>` : '';
    // Mirror DraftEmailView's proven .eml body byte-for-byte so the draft
    // renders identically (including the signature). Outlook-friendly:
    //   • MSO-flavored <html> wrapper.
    //   • <style>ul,ol{margin:0;padding-left:1.5em;}</style> for lists.
    //   • 12pt Aptos/Calibri/Arial body <div>.
    //   • Signature appended outside that body <div> after a <br>.
    //   • \n after </p></li></ul></ol></div> to keep every line under
    //     RFC 5322's 998-char cap (so 8bit CTE works without truncation).
    let body = `<p>Hi,</p><p>${introLine}</p>${itemsHtml}<p>Let me know if I've missed anything or you'd like to dig deeper on any of these.</p><p>Thanks,</p>`;
    body = body
      .replace(/<\/p>/gi, '</p>\n')
      .replace(/<\/li>/gi, '</li>\n')
      .replace(/<\/ul>/gi, '</ul>\n')
      .replace(/<\/ol>/gi, '</ol>\n')
      .replace(/<\/div>/gi, '</div>\n');
    const htmlContent = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">\n<head>\n<!--[if gte mso 9]><xml><w:WordDocument><w:DontHyphenate/><w:DoNotHyphenateCaps/></w:WordDocument></xml><![endif]-->\n<style>\nul,ol{margin:0;padding-left:1.5em;}\n</style>\n</head>\n<body style="margin:0;padding:0;">\n<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:12pt;">\n${body}\n</div>${sigBlock}\n</body>\n</html>`;

    const toHeader = recipients.join(', ');
    // De-dash the whole message: strip literal em dashes (subject/body) and
    // the &mdash; HTML entity so the exported .eml carries only hyphens.
    const eml = stripDashes([
      'MIME-Version: 1.0',
      `Subject: ${subject}`,
      toHeader ? `To: ${toHeader}` : null,
      'X-Unsent: 1',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      htmlContent,
    ].filter(Boolean).join('\r\n')).replace(/&mdash;|&#8212;|&#x2014;/gi, '-');

    const safeName = (selectedOpp.title || fields.company || 'follow-up')
      .replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'follow-up';
    const blob = new Blob([eml], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `followup_${safeName}.eml`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [selectedOpp, companyContacts, fields.company, settings?.emailSignature]);

  const downloadOppAsDocx = useCallback(async () => {
    if (!selectedOpp) return;
    const safeTitle = (selectedOpp.title || 'opportunity').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'opportunity';
    const safeCompany = (fields.company || 'company').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    const bodyHtml = oppNoteDraft && oppNoteDraft.trim() ? oppNoteDraft : '<p></p>';
    const fullHtml = stripDashes(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body><h1>${safeCompany} · ${safeTitle}</h1>${bodyHtml}</body></html>`);
    try {
      const { asBlob: htmlToDocxBlob } = await import('html-docx-js-typescript');
      const result = await htmlToDocxBlob(fullHtml);
      const blob = result instanceof Blob ? result : new Blob([result], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeCompany} - ${safeTitle}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert('Failed to export Word document: ' + (err.message || err));
    }
  }, [selectedOpp, oppNoteDraft, fields.company]);

  const handleOppDocxUpload = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !selectedOppId) return;
    if (!/\.docx$/i.test(file.name)) {
      alert('Please choose a .docx file.');
      return;
    }
    try {
      const { default: mammoth } = await import('mammoth/mammoth.browser');
      const buf = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer: buf });
      const html = result.value || '';
      const replace = !oppNoteDraft || !oppNoteDraft.replace(/<[^>]*>/g, '').trim()
        ? true
        : window.confirm('Replace existing notes with the uploaded document? Click Cancel to append instead.');
      const nextHtml = replace ? html : `${oppNoteDraft}<hr>${html}`;
      setOppNoteDraft(nextHtml);
      if (oppSaveTimerRef.current) clearTimeout(oppSaveTimerRef.current);
      const idAtEdit = selectedOppId;
      const data = (settings.companyOpportunities || {})[companySlug] || { buckets: [], opportunities: [] };
      const nextOpps = (data.opportunities || []).map(o => o.id === idAtEdit ? { ...o, notes: nextHtml, updatedAt: Date.now() } : o);
      updateSettingsPath({ [`companyOpportunities.${companySlug}`]: { buckets: data.buckets || [], opportunities: nextOpps } });
    } catch (err) {
      alert('Failed to read Word document: ' + (err.message || err));
    }
  }, [selectedOppId, oppNoteDraft, companySlug, settings.companyOpportunities, updateSettingsPath]);

  // ── Opportunities tab — separate from Notes, simpler flat list per company.
  // Shape: settings.companyDeals[slug] = [{ id, title, stage, value, closeDate, description, createdAt, updatedAt }]
  const companyDeals = useMemo(() => (
    (settings.companyDeals || {})[companySlug] || []
  ), [settings.companyDeals, companySlug]);
  const [dealsOpen, setDealsOpen] = useState(false);
  const DEAL_STAGES = ['New', 'Qualifying', 'Proposed', 'Quoting', 'Verbal', 'Won', 'Lost', 'Hold'];

  const writeCompanyDeals = useCallback((nextList) => {
    if (!companySlug) return;
    const all = { ...(settings.companyDeals || {}) };
    if (!nextList || nextList.length === 0) delete all[companySlug];
    else all[companySlug] = nextList;
    updateSettings({ companyDeals: all });
  }, [companySlug, settings.companyDeals, updateSettings]);

  const addDeal = useCallback(() => {
    const now = Date.now();
    const deal = {
      id: `d_${now}_${Math.random().toString(36).slice(2, 7)}`,
      title: '',
      stage: 'New',
      value: '',
      closeDate: '',
      description: '',
      createdAt: now,
      updatedAt: now,
    };
    writeCompanyDeals([...companyDeals, deal]);
  }, [companyDeals, writeCompanyDeals]);

  // One-shot backfill: lift any pre-existing raClientMatch / targetAccount
  // values from the currently loaded portfolio rows into
  // settings.savedPortfolioMappings. Runs once per mount after the first
  // time portfolioCompanies is available, so users who had mappings from
  // earlier uploads see the ★ "saved" marker immediately instead of only
  // after touching a cell.
  const portfolioBackfillRan = useRef(false);
  useEffect(() => {
    if (portfolioBackfillRan.current) return;
    const list = fields.portfolioCompanies || [];
    if (list.length === 0) return;
    const saved = settings.savedPortfolioMappings || {};
    const next = { ...saved };
    let dirty = false;
    for (const r of list) {
      const k = (r.companyName || '').toLowerCase().trim();
      if (!k) continue;
      const prior = next[k] || {};
      const merged = { ...prior };
      let changed = false;
      if (r.raClientMatch && prior.raClientMatch !== r.raClientMatch) { merged.raClientMatch = r.raClientMatch; changed = true; }
      if (r.targetAccount && prior.targetAccount !== r.targetAccount) { merged.targetAccount = r.targetAccount; changed = true; }
      if (changed) { merged.updatedAt = Date.now(); next[k] = merged; dirty = true; }
    }
    portfolioBackfillRan.current = true;
    if (dirty) updateSettings({ savedPortfolioMappings: next });
  }, [fields.portfolioCompanies, settings.savedPortfolioMappings, updateSettings]);

  // List Flags: for each Portfolio Company, track which list tabs
  // (CDP, GRESB, SBT, etc.) the name has been flagged on. Used in
  // both the on-screen table column and the exported Portfolio
  // Companies sheet. Refreshes when the portfolio roster changes or
  // a list-tab mapping is saved (custom coverage-changed event).
  const [portfolioListFlags, setPortfolioListFlags] = useState(() => new Map());
  const [portfolioFlagVersion, setPortfolioFlagVersion] = useState(0);
  useEffect(() => {
    const bump = () => setPortfolioFlagVersion(v => v + 1);
    window.addEventListener('my-accounts-coverage-changed', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('my-accounts-coverage-changed', bump);
      window.removeEventListener('storage', bump);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const names = (fields.portfolioCompanies || [])
        .map(r => r.companyName)
        .filter(Boolean);
      if (names.length === 0) {
        if (!cancelled) setPortfolioListFlags(new Map());
        return;
      }
      const flags = await computeListFlags(names, { prospects });
      if (!cancelled) setPortfolioListFlags(flags);
    })();
    return () => { cancelled = true; };
  }, [fields.portfolioCompanies, portfolioFlagVersion, prospects]);

  // Frameworks that come from a *confirmed Lists-page mapping* for this
  // company (My Accounts or Portfolio scope). This is the ONLY source we
  // treat as "Auto". Deliberately computed WITHOUT passing `prospects`:
  // computeListFlags also folds a prospect's own frameworks array into its
  // result, and if we included that here every manually- or Claude-added
  // framework (once saved on the prospect) would masquerade as an
  // auto-mapping. Manual / Claude provenance is tracked separately in
  // fields.frameworkSources.
  const [companyFrameworkFlags, setCompanyFrameworkFlags] = useState(() => new Set());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const name = fields.company;
      if (!name) { if (!cancelled) setCompanyFrameworkFlags(new Set()); return; }
      const flags = await computeListFlags([name]);
      if (cancelled) return;
      const set = flags.get(name.toLowerCase().trim()) || new Set();
      setCompanyFrameworkFlags(set);
    })();
    return () => { cancelled = true; };
  }, [fields.company, portfolioFlagVersion]);
  const effectiveFrameworks = useMemo(() => {
    const out = new Set(fields.frameworks || []);
    for (const f of companyFrameworkFlags) out.add(f);
    return [...out];
  }, [fields.frameworks, companyFrameworkFlags]);

  // How each framework landed on this company. A confirmed Lists-page
  // mapping (companyFrameworkFlags) is authoritative → 'auto'; otherwise
  // the per-framework provenance stored in fields.frameworkSources marks
  // Claude-research additions, with everything else treated as a manual
  // pick in this popup.
  const frameworkSourceOf = useCallback((label) => {
    if (companyFrameworkFlags.has(label)) return 'auto';
    return (fields.frameworkSources || {})[label] === 'claude' ? 'claude' : 'manual';
  }, [companyFrameworkFlags, fields.frameworkSources]);

  // Toggle a framework from the dropdown, recording provenance alongside
  // the array so the badge can distinguish manual picks from Claude/auto.
  // Removing a framework also drops its stored source.
  const toggleFramework = useCallback((value) => {
    setFields(prev => {
      const arr = prev.frameworks || [];
      const has = arr.includes(value);
      const nextArr = has ? arr.filter(v => v !== value) : [...arr, value];
      const sources = { ...(prev.frameworkSources || {}) };
      if (has) delete sources[value];
      else sources[value] = 'manual';
      return { ...prev, frameworks: nextArr, frameworkSources: sources };
    });
  }, []);

  // Strategy-tag vocabulary: built-ins + every tag already in use + the
  // user's custom additions, so the dropdown matches what the PE Firm
  // sub-tab offers.
  const strategyOptions = useMemo(() => buildStrategyOptions(prospects, settings), [prospects, settings]);

  const updateDeal = useCallback((dealId, patch) => {
    writeCompanyDeals(companyDeals.map(d => d.id === dealId ? { ...d, ...patch, updatedAt: Date.now() } : d));
  }, [companyDeals, writeCompanyDeals]);

  const deleteDeal = useCallback((dealId) => {
    const d = companyDeals.find(x => x.id === dealId);
    if (!d) return;
    if (!window.confirm(`Delete opportunity${d.title ? ` "${d.title}"` : ''}?`)) return;
    writeCompanyDeals(companyDeals.filter(x => x.id !== dealId));
  }, [companyDeals, writeCompanyDeals]);

  async function handleDeleteContact(contact) {
    const name = [contact.firstname, contact.lastname].filter(Boolean).join(' ') || 'this contact';
    if (!window.confirm(`Delete ${name} from HubSpot? This cannot be undone.`)) return;
    const cid = contact.id || contact.vid;
    if (!cid) return;
    setDeletingContact(cid);
    try {
      const res = await apiFetch(`/api/hubspot?action=delete-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: cid }),
      });
      if (!res.ok) throw new Error('Delete failed');
      // Remove from local HubSpot cache
      try {
        await updateHubspotCache(draft => {
          draft.contacts = draft.contacts.filter(c => String(c.id || c.vid) !== String(cid));
        });
      } catch {}
      if (onDeleteContact) onDeleteContact(cid);
    } catch (err) {
      alert('Failed to delete contact: ' + (err.message || 'Unknown error'));
    }
    setDeletingContact(null);
  }

  // Bulk-edit / bulk-delete contacts in the company popup. Loops the
  // selected contact ids and pushes either an /api/hubspot update or a
  // local-cache-only write (for _localOnly contacts), then clears the
  // selection. Notes are stored in user settings so they bypass HubSpot
  // entirely.
  async function applyBulkEdit() {
    if (bulkSelected.size === 0) return;
    setBulkApplying(true);
    const targets = companyContacts.filter(c => bulkSelected.has(String(c.id || c.vid)));

    if (bulkField === 'notes') {
      const current = settings.contactNotes || {};
      const next = { ...current };
      for (const c of targets) {
        const cid = c.id || c.vid;
        if (!cid) continue;
        const existing = next[cid] || '';
        const trimmed = (bulkValue || '').trim();
        const merged = bulkMode === 'append' && existing
          ? `${existing}\n${trimmed}`
          : trimmed;
        if (merged) next[cid] = merged;
        else delete next[cid];
      }
      updateSettings({ contactNotes: next });
      setBulkApplying(false);
      setBulkEditOpen(false);
      setBulkSelected(new Set());
      setBulkValue('');
      return;
    }

    const errors = [];
    for (const c of targets) {
      const cid = c.id || c.vid;
      if (!cid) continue;
      let nextVal = bulkValue;
      if (bulkField === 'dans_tags' && bulkMode === 'append') {
        const existing = (c.dans_tags || c.dan_s_tags || c.dans_tag || '')
          .split(';').map(s => s.trim()).filter(Boolean);
        const incoming = (bulkValue || '').split(';').map(s => s.trim()).filter(Boolean);
        const seen = new Set(existing.map(t => t.toLowerCase()));
        for (const t of incoming) if (!seen.has(t.toLowerCase())) { existing.push(t); seen.add(t.toLowerCase()); }
        nextVal = existing.join(';');
      }
      const properties = { [bulkField]: nextVal };
      if (c._localOnly) {
        try {
          await updateHubspotCache(draft => {
            const i = draft.contacts.findIndex(x => String(x.id || x.vid) === String(cid));
            if (i !== -1) draft.contacts[i] = { ...draft.contacts[i], ...properties };
          });
        } catch (err) { errors.push(`${cid}: ${err.message || err}`); }
        continue;
      }
      try {
        const res = await apiFetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: cid, properties }),
        });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json?.message || json?.error || `HubSpot ${res.status}`);
        try {
          await updateHubspotCache(draft => {
            const i = draft.contacts.findIndex(x => String(x.id || x.vid) === String(cid));
            if (i !== -1) draft.contacts[i] = { ...draft.contacts[i], ...properties };
          });
        } catch {}
      } catch (err) {
        errors.push(`${cid}: ${err.message || err}`);
      }
    }
    setBulkApplying(false);
    setBulkEditOpen(false);
    setBulkSelected(new Set());
    setBulkValue('');
    if (errors.length) alert(`Bulk edit completed with ${errors.length} error(s):\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n…and ${errors.length - 5} more` : ''}`);
  }

  async function applyBulkDelete() {
    const targets = companyContacts.filter(c => bulkSelected.has(String(c.id || c.vid)));
    if (targets.length === 0) return;
    if (!window.confirm(`Delete ${targets.length} contact${targets.length === 1 ? '' : 's'} from HubSpot? This cannot be undone.`)) return;
    setBulkApplying(true);
    const errors = [];
    for (const c of targets) {
      const cid = c.id || c.vid;
      if (!cid) continue;
      if (c._localOnly) {
        try {
          await updateHubspotCache(draft => {
            draft.contacts = draft.contacts.filter(x => String(x.id || x.vid) !== String(cid));
          });
        } catch (err) { errors.push(`${cid}: ${err.message || err}`); }
        if (onDeleteContact) onDeleteContact(cid);
        continue;
      }
      try {
        const res = await apiFetch('/api/hubspot?action=delete-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: cid }),
        });
        if (!res.ok) throw new Error('Delete failed');
        try {
          await updateHubspotCache(draft => {
            draft.contacts = draft.contacts.filter(x => String(x.id || x.vid) !== String(cid));
          });
        } catch {}
        if (onDeleteContact) onDeleteContact(cid);
      } catch (err) {
        errors.push(`${cid}: ${err.message || err}`);
      }
    }
    setBulkApplying(false);
    setBulkSelected(new Set());
    if (errors.length) alert(`Bulk delete completed with ${errors.length} error(s):\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n…and ${errors.length - 5} more` : ''}`);
  }

  // Reset selection whenever the underlying contact list changes
  // (e.g. user switches prospect or HubSpot cache refreshes).
  useEffect(() => { setBulkSelected(new Set()); }, [fields.company]);

  const initialRef = useRef(true);
  const saveTimerRef = useRef(null);

  function set(key, value) {
    setFields(prev => ({ ...prev, [key]: value }));
  }

  // When the user renames the company, the per-company data buckets
  // (Notes / Deals / Research / portfolio source file) all key off a
  // slug derived from the company name. Copy them under the new slug
  // so nothing gets stranded. If another prospect still references
  // the old name, the original entries stay in place to keep that
  // prospect's view intact; otherwise the old slug is cleared. Skips
  // when the slug doesn't actually change (case-only edits) or when
  // the destination slug already has data (don't clobber).
  function migrateCompanyData(oldName, newName) {
    const slugify = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
    const oldSlug = slugify(oldName);
    const newSlug = slugify(newName);
    if (!oldSlug || !newSlug) return;
    if (oldSlug === newSlug) {
      // Case- or punctuation-only edits land on the same slug, so none of
      // the buckets need to move — but a site list also stores the company
      // name as text, and that copy is what the Site List Overview and the
      // Utility Lookup picker render. Carry the new spelling onto it.
      const renamedSame = renameCompanySiteListEntry(
        (settings.companySiteLists || {})[newSlug], oldName, newName,
      );
      if (renamedSame) updateSettingsPath({ [`companySiteLists.${newSlug}`]: renamedSame.entry });
      return;
    }
    const patches = {};
    const oldOpps = (settings.companyOpportunities || {})[oldSlug];
    const newOpps = (settings.companyOpportunities || {})[newSlug];
    const hasOldOpps = oldOpps && (
      (Array.isArray(oldOpps.opportunities) && oldOpps.opportunities.length > 0)
      || (Array.isArray(oldOpps.buckets) && oldOpps.buckets.length > 0)
    );
    const hasNewOpps = newOpps && (
      (Array.isArray(newOpps.opportunities) && newOpps.opportunities.length > 0)
      || (Array.isArray(newOpps.buckets) && newOpps.buckets.length > 0)
    );
    if (hasOldOpps && !hasNewOpps) patches[`companyOpportunities.${newSlug}`] = oldOpps;

    const oldDeals = (settings.companyDeals || {})[oldSlug];
    const newDeals = (settings.companyDeals || {})[newSlug];
    if (Array.isArray(oldDeals) && oldDeals.length > 0 && !(Array.isArray(newDeals) && newDeals.length > 0)) {
      patches[`companyDeals.${newSlug}`] = oldDeals;
    }

    const oldResearch = (settings.companyResearch || {})[oldSlug];
    const newResearch = (settings.companyResearch || {})[newSlug];
    if (oldResearch && !newResearch) patches[`companyResearch.${newSlug}`] = oldResearch;

    // The site list moves with the old name taken out of it: the entry is
    // keyed by slug, but it also stores the company as text — as its own
    // label, which every page listing site lists renders (Draft Emails'
    // Site List Overview, the Utility Lookup company picker), and in the
    // uploaded rows' company column. Copying it verbatim left the old name
    // on screen under a new-slug key.
    const oldSiteList = (settings.companySiteLists || {})[oldSlug];
    const newSiteList = (settings.companySiteLists || {})[newSlug];
    if (oldSiteList && !newSiteList) {
      const renamed = renameCompanySiteListEntry(oldSiteList, oldName, newName);
      patches[`companySiteLists.${newSlug}`] = renamed ? renamed.entry : oldSiteList;
    }

    // Drop the old slug entries when no other prospect still maps to
    // the old company name — otherwise leave them so the other record
    // keeps working.
    const stillReferenced = (prospects || []).some(p => {
      if (!p || p.id === prospect?.id) return false;
      return slugify(p.company) === oldSlug;
    });
    if (!stillReferenced) {
      if (hasOldOpps) patches[`companyOpportunities.${oldSlug}`] = null;
      if (Array.isArray(oldDeals) && oldDeals.length > 0) patches[`companyDeals.${oldSlug}`] = null;
      if (oldResearch) patches[`companyResearch.${oldSlug}`] = null;
      if (oldSiteList) patches[`companySiteLists.${oldSlug}`] = null;
    }

    if (Object.keys(patches).length > 0) updateSettingsPath(patches);
    // Rename the IDB portfolio source file in step. Fire-and-forget;
    // load paths fall back gracefully if it hasn't landed yet.
    renamePortfolioSourceFile(oldName, newName).catch(() => {});
  }

  // Repoint every name-keyed cross-reference (opp Account, portfolio
  // companies' PE Owner, dismissed suggestions, confirmed list mappings)
  // from the old company name onto the new one, so a rename doesn't
  // silently detach opps/portfolio/flags. Loads the opps store, builds a
  // plan, and applies it only after the user confirms a summary of what
  // will change. HubSpot is deliberately not touched. Fire-and-forget
  // from the Company field commit; failures are logged, not surfaced
  // mid-edit.
  async function cascadeCompanyRenameLinks(oldName, newName) {
    try {
      const uid = user?.uid;
      let oppsRecords = [];
      if (uid) {
        try {
          const data = await loadOpps2Newest(uid);
          if (Array.isArray(data?.records)) oppsRecords = data.records;
        } catch { /* opps not loaded — skip the opps leg, still migrate the rest */ }
      }
      const plan = buildCompanyRenamePlan({
        oldName, newName, prospects, currentProspectId: prospect?.id, settings, oppsRecords,
      });
      // HubSpot contacts that belong to the old company name: every contact
      // whose company text matches (same matcher the popup uses), plus any
      // explicitly pinned to the old name. These move onto the new name so
      // they stay mapped to the renamed company and display it everywhere.
      const cleanNew = String(newName || '').trim();
      const oldKey = String(oldName || '').trim().toLowerCase();
      const newKey = cleanNew.toLowerCase();
      const links = settings.companyContactLinks || {};
      const pinnedIds = Array.isArray(links[oldKey]) ? links[oldKey].map(String) : [];
      const contactTargets = (hubspotContacts || []).filter(c => companiesMatch(c.company, oldName));
      const contactCount = contactTargets.length;

      // Clients-view subtabs (Deals / Commissions rows, plus the typed
      // Clients-tab fields and deal→client mappings) key off the company
      // name string, so they need to move onto the new name too.
      const clientCounts = countClientsSubtabRename(oldName, newName);
      const clientTotal = clientsSubtabRenameTotal(clientCounts);

      // Target Accounts: the uploaded workbook rows (name = leftmost column)
      // plus the blocked-suggestions set, both keyed by the account name.
      let taData = null;
      if (uid) { try { taData = await loadTargetAccountsFromDB(uid); } catch { /* skip the TA leg */ } }
      const taPlan = renameTargetAccountRows(taData, oldName, newName);
      const blockedCount = countBlockedAccountRename(oldName, newName);

      // Site lists: the Master Site List and the Utility Lookup sites file
      // both name the company on every row as free text, so a rename that
      // skipped them would strand those sites under the old name (the
      // Master Site List would list the company as unmapped).
      const sitePlan = await planSiteListRename(oldName, newName);

      // The Google Sheet the additive import reads. Its row keeps the old
      // name unless we write through, and the importer treats a name it
      // can't find on the site as a company to add — which is how a
      // renamed company comes back as a second account on the next pass.
      const sheetConfig = readSheetSync(settings);
      const sheetId = spreadsheetIdFromUrl(sheetConfig.sheetsUrl);
      const sheetTab = sheetConfig.sheetName || 'Accounts';
      let sheetRename = { row: null, reason: 'not-configured', from: null };
      if (sheetId) {
        try {
          const res = await apiFetch(
            `/api/sheets-sync?spreadsheetId=${sheetId}&sheetName=${encodeURIComponent(sheetTab)}&_t=${Date.now()}`,
          );
          const data = await res.json();
          if (!data.error) sheetRename = planSheetCompanyRename(data.names, oldName, newName);
        } catch (err) {
          console.warn('Company rename: could not read the Google Sheet', err?.message || err);
        }
      }

      if (!planHasWork(plan) && contactCount === 0 && pinnedIds.length === 0
        && clientTotal === 0 && taPlan.count === 0 && blockedCount === 0
        && sitePlan.count === 0 && sheetRename.row == null) return;
      const summaryLines = summarizeRenamePlan(plan);
      if (contactCount > 0) summaryLines.push(`• ${contactCount} HubSpot contact${contactCount === 1 ? '' : 's'} (Company)`);
      summaryLines.push(...summarizeClientsSubtabRename(clientCounts));
      if (taPlan.count > 0) summaryLines.push(`• ${taPlan.count} Target Account row${taPlan.count === 1 ? '' : 's'}`);
      if (blockedCount > 0) summaryLines.push('• 1 blocked-account entry');
      summaryLines.push(...summarizeSiteListRename(sitePlan));
      if (sheetRename.row != null) summaryLines.push('• the Google Sheet row (otherwise the old name is re-imported)');
      const ok = window.confirm(
        `Renamed to "${newName}".\n\nAlso update these references to "${oldName}"?\n\n${summaryLines.join('\n')}`
      );
      if (!ok) return;
      if (clientTotal > 0) applyClientsSubtabRename(oldName, newName);
      if (sitePlan.count > 0) {
        try { await applySiteListRename(sitePlan); }
        catch (err) { console.error('Company rename: site list update failed', err); }
      }
      if (taPlan.count > 0 && uid) {
        try { await saveTargetAccountsToDB(uid, taPlan.data); }
        catch (err) { console.error('Company rename: target accounts update failed', err); }
      }
      if (blockedCount > 0) renameBlockedAccountName(oldName, newName);
      if (sheetRename.row != null && sheetId) {
        try {
          const res = await apiFetch('/api/sheets-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              spreadsheetId: sheetId, sheetName: sheetTab, mode: 'rename',
              // The sheet's own current text for that cell, which is what
              // the server re-checks — not the app's old name, which on a
              // key match is a different spelling.
              row: sheetRename.row, from: sheetRename.from, to: newName,
            }),
          });
          const out = await res.json();
          // The server re-checks the cell and declines rather than
          // renaming the wrong row if the sheet moved under us.
          if (out.error) throw new Error(out.error);
          if (!out.renamed) {
            console.warn(`Company rename: the Google Sheet row now reads "${out.found}" — left alone`);
          }
        } catch (err) { console.error('Company rename: Google Sheet update failed', err); }
      }
      if (plan.oppIds.length && uid) {
        try { await bulkSetOppField(uid, plan.oppIds, 'Account', newName); }
        catch (err) { console.error('Company rename: opps Account update failed', err); }
      }
      for (const u of plan.peOwnerUpdates) {
        try { onUpdateProspect?.(u.id, { peOwner: u.peOwner }); }
        catch (err) { console.error('Company rename: peOwner update failed', u.id, err); }
      }
      // PE firms' own portfolio-company lists naming the renamed company.
      for (const u of plan.portfolioUpdates) {
        try { onUpdateProspect?.(u.id, { portfolioCompanies: u.portfolioCompanies }); }
        catch (err) { console.error('Company rename: portfolioCompanies update failed', u.id, err); }
      }
      if (plan.savedPortfolioMappings) updateSettings({ savedPortfolioMappings: plan.savedPortfolioMappings });
      if (plan.events) updateSettings({ events: plan.events });
      if (plan.dismissed) updateSettings({ dismissedPortfolioGuesses: plan.dismissed });
      applyListMappingWrites(plan);

      // ── HubSpot contacts leg ──
      const settingsPatch = {};
      // Move the pin key so explicitly-linked contacts follow the rename.
      if (pinnedIds.length && oldKey !== newKey) {
        const mergedPins = Array.from(new Set([...((links[newKey] || []).map(String)), ...pinnedIds]));
        const nextLinks = { ...links, [newKey]: mergedPins };
        delete nextLinks[oldKey];
        settingsPatch.companyContactLinks = nextLinks;
      }
      // Move the exclusion key too, otherwise contacts the user hid from the
      // company's roster reappear under the new name on rename.
      const exclusions = settings.companyContactExclusions || {};
      const oldExcluded = Array.isArray(exclusions[oldKey]) ? exclusions[oldKey].map(String) : [];
      if (oldExcluded.length && oldKey !== newKey) {
        const mergedEx = Array.from(new Set([...((exclusions[newKey] || []).map(String)), ...oldExcluded]));
        const nextEx = { ...exclusions, [newKey]: mergedEx };
        delete nextEx[oldKey];
        settingsPatch.companyContactExclusions = nextEx;
      }
      // Durable local override so the new name sticks across HubSpot refreshes
      // even when the server-side Company reassignment lags or resolves to a
      // different canonical name.
      if (contactCount > 0) {
        const localFields = { ...(settings.contactLocalFields || {}) };
        for (const c of contactTargets) {
          const id = String(c.id || c.vid || '');
          if (!id) continue;
          localFields[id] = { ...(localFields[id] || {}), _companyOverride: cleanNew };
        }
        settingsPatch.contactLocalFields = localFields;
      }
      if (Object.keys(settingsPatch).length) updateSettings(settingsPatch);

      if (contactCount > 0) {
        // Rewrite the cached company text immediately so every view shows the
        // new name without waiting for a HubSpot refresh.
        try {
          await updateHubspotCache(draft => {
            draft.contacts = draft.contacts.map(c =>
              companiesMatch(c.company, oldName) ? { ...c, company: cleanNew } : c
            );
          });
        } catch (err) { console.warn('Company rename: contact cache update failed', err?.message || err); }
        // Best-effort: push the rename to HubSpot, which also reassigns each
        // contact's primary Company association so the CRM stays in sync. On
        // failure the local override + cache rewrite remain as the fallback.
        for (const c of contactTargets) {
          const id = c.id || c.vid;
          if (!id) continue;
          try {
            await apiFetch('/api/hubspot?action=update-contact', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contactId: id, properties: { company: cleanNew } }),
            });
          } catch { /* fallback already in place */ }
        }
      }
    } catch (err) {
      console.error('Company rename cascade failed', err);
    }
  }

  // A prospect's company name lives on each prospect record independently,
  // so renaming the company here only touches THIS record. When other
  // prospects carry the exact same company name, offer to rename them all
  // in one action. We match on the trimmed, case-insensitive old name so a
  // rename never silently sweeps up a differently-named company; declining
  // leaves the other records untouched. Fired alongside migrateCompanyData
  // when the Company field commits to a new value.
  function renameCompanyAcrossProspects(oldName, newName) {
    if (!onUpdateProspect) return;
    const norm = (s) => (s || '').trim().toLowerCase();
    const oldNorm = norm(oldName);
    if (!oldNorm) return;
    const others = (prospects || []).filter(
      p => p && p.id !== prospect?.id && norm(p.company) === oldNorm
    );
    if (others.length === 0) return;
    const isOne = others.length === 1;
    const ok = window.confirm(
      `${others.length} other prospect${isOne ? '' : 's'} ${isOne ? 'is' : 'are'} also named "${oldName}". `
      + `Rename ${isOne ? 'it' : 'them all'} to "${newName}" too?`
    );
    if (!ok) return;
    others.forEach(p => { onUpdateProspect(p.id, { company: newName }); });
  }

  function toggleArrayField(key, value) {
    setFields(prev => {
      const arr = prev[key] || [];
      const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
      return { ...prev, [key]: next };
    });
  }

  // Auto-save on every change (debounced 600ms)
  useEffect(() => {
    if (isNew || initialRef.current) {
      initialRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (!fields.company?.trim()) return;
      const data = { ...fields };
      data.peAum = data.peAum === '' || data.peAum == null ? null : Number(data.peAum);
      data.reAum = data.reAum === '' || data.reAum == null ? null : Number(data.reAum);
      data.numberOfSites = data.numberOfSites === '' || data.numberOfSites == null ? null : Number(data.numberOfSites);
      data.numberOfAccounts = data.numberOfAccounts === '' || data.numberOfAccounts == null ? null : Number(data.numberOfAccounts);
      delete data.id;
      delete data.createdAt;
      delete data.updatedAt;
      onSave(data, { close: false });
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 1500);
    }, 600);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [fields]);

  function handleSave() {
    if (!fields.company.trim()) return;
    const data = { ...fields };
    data.peAum = data.peAum === '' || data.peAum == null ? null : Number(data.peAum);
    data.reAum = data.reAum === '' || data.reAum == null ? null : Number(data.reAum);
    data.numberOfSites = data.numberOfSites === '' || data.numberOfSites == null ? null : Number(data.numberOfSites);
    data.numberOfAccounts = data.numberOfAccounts === '' || data.numberOfAccounts == null ? null : Number(data.numberOfAccounts);
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;
    onSave(data);
  }

  // Swap this popup for another company's. Edits here autosave on a debounce,
  // and the timer is cleared when this modal unmounts — so an edit made in the
  // last 600ms would be dropped by the navigation that replaces us. Write it
  // out first, then hand over.
  function openProspect(target) {
    if (!target || !onSelectProspect) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (fields.company?.trim()) {
        const data = { ...fields };
        data.peAum = data.peAum === '' || data.peAum == null ? null : Number(data.peAum);
        data.reAum = data.reAum === '' || data.reAum == null ? null : Number(data.reAum);
        data.numberOfSites = data.numberOfSites === '' || data.numberOfSites == null ? null : Number(data.numberOfSites);
        data.numberOfAccounts = data.numberOfAccounts === '' || data.numberOfAccounts == null ? null : Number(data.numberOfAccounts);
        delete data.id;
        delete data.createdAt;
        delete data.updatedAt;
        onSave(data, { close: false });
      }
    }
    onSelectProspect(target);
  }

  function handlePrint() {
    const win = window.open('', '_blank');
    if (!win) { alert('Please allow popups to export PDF'); return; }
    const roleColors = { 'Decision Maker': '#166534', 'Influencer': '#1E40AF', 'Left': '#92400E', 'Other': '#7C3AED', 'Hide': '#991B1B', 'Unknown': '#6B7280' };
    const roleBgs = { 'Decision Maker': '#DCFCE7', 'Influencer': '#DBEAFE', 'Left': '#FEF9C3', 'Other': '#F3E8FF', 'Hide': '#FEE2E2', 'Unknown': '#F3F4F6' };

    let contactRows = '';
    for (const c of companyContacts) {
      const name = [c.firstname, c.lastname].filter(Boolean).join(' ') || '-';
      const r = c.decision_maker || 'Unknown';
      const role = (r === 'true' || r === 'Yes') ? 'Decision Maker' : (r === 'No' || r === 'false') ? 'Unknown' : r;
      const linkedin = c.hs_linkedin_url || c.linkedin_url || c.hs_linkedinid || '';
      contactRows += `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;font-weight:600">${name}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0">${c.jobtitle || '-'}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0">${c.email || '-'}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0">${c.phone || '-'}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0"><span style="padding:1px 6px;border-radius:999px;font-size:0.7rem;font-weight:700;background:${roleBgs[role] || '#F3F4F6'};color:${roleColors[role] || '#6B7280'}">${role}</span></td>
        <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0">${linkedin ? `<a href="${linkedin.startsWith('http') ? linkedin : 'https://linkedin.com/in/' + linkedin}">${linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, '').replace(/\/$/, '')}</a>` : '—'}</td>
      </tr>`;
    }

    const f = fields;
    win.document.write(`<!DOCTYPE html><html><head><title>${f.company}: Prospect Report</title>
      <style>body{font-family:Arial,sans-serif;max-width:1000px;margin:0 auto;padding:20px;color:#1E293B}
      h1{font-size:1.5rem;margin-bottom:4px}table{width:100%;border-collapse:collapse;font-size:0.8rem;margin-top:8px}
      th{text-align:left;padding:6px 8px;background:#F8FAFC;border-bottom:2px solid #E2E8F0;font-size:0.72rem;text-transform:uppercase;color:#64748B;letter-spacing:0.03em}
      .info{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:12px 0;font-size:0.85rem}
      .info-item{padding:6px 10px;background:#F8FAFC;border-radius:6px}.info-label{font-size:0.7rem;color:#64748B;text-transform:uppercase;letter-spacing:0.03em;font-weight:600}.info-val{font-weight:600;margin-top:2px}
      a{color:#0A66C2;text-decoration:none}@media print{body{padding:10px}}</style></head><body>
      <h1>${f.company}</h1>
      <div style="color:#64748B;font-size:0.85rem;margin-bottom:12px">Generated ${new Date().toLocaleDateString()}</div>
      <div class="info">
        <div class="info-item"><div class="info-label">Status</div><div class="info-val">${f.status || '-'}</div></div>
        <div class="info-item"><div class="info-label">Tier</div><div class="info-val">${f.tier || '-'}</div></div>
        <div class="info-item"><div class="info-label">Type</div><div class="info-val">${f.type || '-'}</div></div>
        <div class="info-item"><div class="info-label">Geography</div><div class="info-val">${f.geography || '-'}</div></div>
        <div class="info-item"><div class="info-label">Public/Private</div><div class="info-val">${f.publicPrivate || '-'}</div></div>
        <div class="info-item"><div class="info-label">CDM</div><div class="info-val">${f.cdm || '-'}</div></div>
        <div class="info-item"><div class="info-label">RE AUM</div><div class="info-val">${f.reAum != null ? '$' + f.reAum + 'B' : '-'}</div></div>
        <div class="info-item"><div class="info-label">PE AUM</div><div class="info-val">${f.peAum != null ? '$' + f.peAum + 'B' : '-'}</div></div>
        <div class="info-item"><div class="info-label">Sites</div><div class="info-val">${f.numberOfSites ?? '-'}</div></div>
        <div class="info-item"><div class="info-label">Accounts</div><div class="info-val">${f.numberOfAccounts ?? '-'}</div></div>
        <div class="info-item"><div class="info-label">Est. Annual Data Deal</div><div class="info-val">${estAnnualDataDeal != null ? '$' + estAnnualDataDeal.toLocaleString() : '-'}</div></div>
        <div class="info-item"><div class="info-label">Revenue</div><div class="info-val">${f.revenue || '-'}</div></div>
        <div class="info-item"><div class="info-label">HQ Region</div><div class="info-val">${f.hqRegion || '-'}</div></div>
        <div class="info-item"><div class="info-label">Website</div><div class="info-val">${f.website ? `<a href="${f.website.startsWith('http') ? f.website : 'https://' + f.website}">${f.website}</a>` : '-'}</div></div>
        <div class="info-item"><div class="info-label">Email Domain</div><div class="info-val">${f.emailDomain || '-'}</div></div>
      </div>
      ${f.notes ? `<div style="margin:12px 0;padding:8px 12px;background:#F8FAFC;border-radius:6px;font-size:0.85rem"><strong style="font-size:0.72rem;color:#64748B;text-transform:uppercase">Notes</strong><div style="margin-top:4px">${f.notes}</div></div>` : ''}
      ${f.sustainabilityTargets ? `<div style="margin:12px 0;padding:8px 12px;background:#F0FDF4;border-radius:6px;font-size:0.85rem"><strong style="font-size:0.72rem;color:#15803D;text-transform:uppercase">Sustainability Targets</strong><div style="margin-top:4px;white-space:pre-line">${f.sustainabilityTargets}</div></div>` : ''}
      <h2 style="font-size:1.1rem;margin-top:20px;margin-bottom:4px">Contacts (${companyContacts.length})</h2>
      ${companyContacts.length > 0 ? `<table><thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Phone</th><th>Role</th><th>LinkedIn</th></tr></thead><tbody>${contactRows}</tbody></table>` : '<div style="color:#9CA3AF;font-style:italic;margin-top:8px">No HubSpot contacts found</div>'}
      <div style="margin-top:24px;font-size:0.7rem;color:#9CA3AF">Prospect Tracker: ${new Date().toLocaleString()}</div>
      </body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 300);
  }

  // Merge-duplicate workflow: pick another prospect and fold it into
  // this one, then delete the picked record. Arrays get concat+dedup;
  // object maps shallow-merge with this record winning on collision.
  async function performMerge(sourceProspect) {
    if (!sourceProspect || sourceProspect.id === prospect.id) return;
    if (!onUpdateProspect || !onDeleteProspect) {
      alert('Merge is only available on existing records.');
      return;
    }
    const confirmMsg = `Merge "${sourceProspect.company || sourceProspect.id}" into "${fields.company}"?\n\nThis will pull any missing fields from the other record and permanently delete it. This can't be undone.`;
    if (!window.confirm(confirmMsg)) return;
    const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const merged = { ...fields };
    for (const [k, vSrc] of Object.entries(sourceProspect || {})) {
      if (k === 'id') continue;
      const vCur = merged[k];
      if (Array.isArray(vCur) && Array.isArray(vSrc)) {
        // Concat + dedup primitives; for objects keep both (stringify dedup).
        const seen = new Set();
        const out = [];
        for (const item of [...vCur, ...vSrc]) {
          const key = typeof item === 'object' ? JSON.stringify(item) : String(item);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(item);
        }
        merged[k] = out;
      } else if (isPlainObject(vCur) && isPlainObject(vSrc)) {
        merged[k] = { ...vSrc, ...vCur };
      } else if (isEmpty(vCur) && !isEmpty(vSrc)) {
        merged[k] = vSrc;
      }
    }
    try {
      await onUpdateProspect(prospect.id, merged);
      await onDeleteProspect(sourceProspect.id);
      setMergeOpen(false);
    } catch (err) {
      alert(`Merge failed: ${err?.message || err}`);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{isNew ? 'Add Prospect' : fields.company}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {!isNew && fields.company && (
              <button
                ref={listsMatchBtnRef}
                type="button"
                onClick={() => setListsMatchOpen(o => !o)}
                title="Scan every uploaded list for rows matching this company name and accept or reject the mapping"
                style={{ padding: '0.25rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, background: listsMatchOpen ? '#EFF6FF' : '#fff', fontSize: '0.72rem', fontWeight: 600, color: '#334155', cursor: 'pointer', fontFamily: 'inherit' }}
              >Search lists…</button>
            )}
            {!isNew && onDeleteProspect && onUpdateProspect && (
              <button
                type="button"
                onClick={() => setMergeOpen(true)}
                title="Combine another prospect record into this one, then delete the other"
                style={{ padding: '0.25rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.72rem', fontWeight: 600, color: '#334155', cursor: 'pointer', fontFamily: 'inherit' }}
              >Merge duplicate…</button>
            )}
            {!isNew && onDeleteProspect && (
              <button
                type="button"
                onClick={async () => {
                  const name = fields.company || 'this company';
                  if (!window.confirm(`Delete "${name}" from Table View?\n\nThis permanently removes the company record: its fields, notes, and Portfolio Companies tab. This can't be undone.`)) return;
                  try {
                    await onDeleteProspect(prospect.id);
                    onClose();
                  } catch (err) {
                    alert(`Delete failed: ${err?.message || err}`);
                  }
                }}
                title="Permanently delete this company from Table View"
                style={{ padding: '0.25rem 0.6rem', border: '1px solid #FCA5A5', borderRadius: 6, background: '#fff', fontSize: '0.72rem', fontWeight: 600, color: '#B91C1C', cursor: 'pointer', fontFamily: 'inherit' }}
              >Delete…</button>
            )}
            <button className={styles.closeBtn} onClick={onClose}>&times;</button>
          </div>
        </div>
        {!isNew && listsMatchOpen && fields.company && (
          <ListsMatchPanel
            anchorRef={listsMatchBtnRef}
            prospectCompany={fields.company}
            settings={settings}
            updateSettingsPath={updateSettingsPath}
            onClose={() => setListsMatchOpen(false)}
          />
        )}
        <div className={styles.body}>
          {raClientMatches.length > 0 && (
            /* One horizontal strip: warning, headline, explanation, then the
               matched clients pushed to the right end. It used to stack those
               four onto their own lines, which cost three rows of the modal
               above the fold to say one thing. Wraps rather than squashes when
               the modal is narrow. */
            <div style={{
              marginBottom: '0.8rem',
              padding: '0.4rem 0.8rem',
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.35rem 0.7rem',
            }}>
              <span style={{ fontSize: '0.95rem', lineHeight: 1 }}>⚠️</span>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                {raClientMatches.some(m => m.exact) ? 'Matches an RA Client' : 'Possible RA Client match'}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#78350F', minWidth: 0 }}>
                This company looks like {raClientMatches.length === 1 ? 'an existing RA Client' : 'existing RA Clients'} on the Lists → RA Clients tab. Double-check before prospecting.
              </span>
              <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35rem', marginLeft: 'auto' }}>
                {raClientMatches.map(m => (
                  <span
                    key={m.name}
                    title={m.cm ? `Client Manager: ${m.cm}` : undefined}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      padding: '0.15rem 0.5rem', background: '#FEF3C7', border: '1px solid #FDE68A',
                      borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, color: '#92400E',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.name}
                    <span style={{ fontWeight: 700, color: '#B45309' }}>{m.exact ? 'exact' : `${Math.round(m.score * 100)}%`}</span>
                    {m.cm && <span style={{ fontWeight: 400, color: '#A16207' }}>· {m.cm}</span>}
                  </span>
                ))}
              </span>
            </div>
          )}
          {indicativeAnalysis && (
            <div style={{
              marginBottom: '0.8rem',
              padding: '0.6rem 0.8rem',
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.8rem',
              flexWrap: 'wrap',
            }}>
              <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Indicative Savings Analysis
                </div>
                <div style={{ fontSize: '0.78rem', color: '#1E293B', fontWeight: 600, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {indicativeAnalysis.fileName || 'Indicative Savings by State.xlsx'}
                </div>
                <div style={{ fontSize: '0.68rem', color: '#475569', marginTop: '0.1rem' }}>
                  {(() => {
                    const ts = indicativeAnalysis.capturedAt?.toDate?.();
                    const when = ts ? ts.toLocaleString() : 'Recently saved';
                    const kb = indicativeAnalysis.sizeBytes ? ` · ${Math.round(indicativeAnalysis.sizeBytes / 1024).toLocaleString()} KB` : '';
                    return `Saved ${when}${kb}`;
                  })()}
                </div>
                {analysisError && (
                  <div style={{ fontSize: '0.68rem', color: '#B91C1C', marginTop: '0.2rem' }}>{analysisError}</div>
                )}
              </div>
              <button
                type="button"
                onClick={downloadIndicativeAnalysis}
                disabled={analysisDownloading}
                title={analysisDownloading ? 'Fetching the workbook…' : 'Download the saved analysis'}
                style={{
                  padding: '0.4rem 0.9rem',
                  background: analysisDownloading ? '#94A3B8' : '#009530',
                  color: '#fff',
                  border: `1px solid ${analysisDownloading ? '#94A3B8' : '#009530'}`,
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: analysisDownloading ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >{analysisDownloading ? 'Preparing…' : '⬇ Download'}</button>
            </div>
          )}
          <div className={styles.grid}>
            <div className={styles.sectionHead}>Identity</div>

            <div>
              <label className={styles.label}>Company</label>
              <CommitOnBlurInput
                className={styles.input}
                value={fields.company}
                onCommit={v => {
                  const oldName = fields.company || '';
                  const newName = (v || '').trim();
                  if (oldName && newName && oldName.trim() !== newName) {
                    migrateCompanyData(oldName, newName);
                    renameCompanyAcrossProspects(oldName, newName);
                    cascadeCompanyRenameLinks(oldName, newName);
                  }
                  set('company', v);
                }}
                placeholder="Company name"
              />
            </div>

            <div>
              <label className={styles.label}>Website</label>
              <CommitOnBlurInput className={styles.input} value={fields.website} onCommit={v => set('website', v)} placeholder="www.example.com" />
            </div>

            <div>
              <label className={styles.label}>BFO Company Name</label>
              <CommitOnBlurInput className={styles.input} value={fields.bfoCompanyName ?? ''} onCommit={v => set('bfoCompanyName', v)} placeholder="Name as it appears in BFO" />
            </div>

            <div>
              <label className={styles.label}>Contracting Entity</label>
              <CommitOnBlurInput className={styles.input} value={fields.contractingEntity ?? ''} onCommit={v => set('contractingEntity', v)} placeholder="Legal entity on the contract" />
            </div>

            <div>
              <label className={styles.label}>PE Owner/Parent Company <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(if portfolio co)</span></label>
              {(() => {
                const setPeOpen = setPeOwnerPickerOpen;
                const peOpen = peOwnerPickerOpen;
                // Pull candidates from the full Table View / prospects list, not just Type=PE.
                const allCompanies = (prospects || [])
                  .filter(p => p.company && p.company !== fields.company);
                // The field holds one or more comma-separated owners.
                // Filter on the segment after the last separator so a
                // second owner can be picked without losing the first —
                // "Blue Owl Capital, KK" searches "kk"; picking replaces
                // just that trailing segment.
                const rawPeOwner = fields.peOwner || '';
                const segCut = Math.max(rawPeOwner.lastIndexOf(','), rawPeOwner.lastIndexOf(';'));
                const committedOwners = segCut >= 0 ? rawPeOwner.slice(0, segCut + 1).trim() : '';
                const q = (segCut >= 0 ? rawPeOwner.slice(segCut + 1) : rawPeOwner).toLowerCase().trim();
                const pickOwner = (name) => set('peOwner', committedOwners ? `${committedOwners} ${name}` : name);
                const ownerSet = new Set(splitPeOwners(rawPeOwner).map(o => o.toLowerCase()));
                // When user is typing, show matches anywhere. Prefer Private Equity type matches first.
                function score(p) {
                  const name = (p.company || '').toLowerCase();
                  if (!q) return p.type === 'Private Equity' ? 0 : 1;
                  if (name.startsWith(q)) return p.type === 'Private Equity' ? 0 : 2;
                  if (name.includes(q)) return p.type === 'Private Equity' ? 1 : 3;
                  return 99;
                }
                const filtered = allCompanies
                  .filter(p => !q || (p.company || '').toLowerCase().includes(q))
                  .sort((a, b) => {
                    const sa = score(a), sb = score(b);
                    if (sa !== sb) return sa - sb;
                    return (a.company || '').localeCompare(b.company || '');
                  })
                  .slice(0, 50);
                return (
                  <div style={{ position: 'relative' }} data-pe-picker>
                    <input
                      className={styles.input}
                      value={fields.peOwner || ''}
                      onChange={e => { set('peOwner', e.target.value); setPeOpen(true); }}
                      onFocus={() => setPeOpen(true)}
                      placeholder="Type a company name: comma-separate multiple owners…"
                    />
                    {peOpen && allCompanies.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 260, overflowY: 'auto', zIndex: 100 }}>
                        {filtered.length === 0 ? (
                          <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic' }}>No companies match &quot;{q}&quot;</div>
                        ) : filtered.map(p => {
                          const isPE = p.type === 'Private Equity';
                          const isPicked = ownerSet.has((p.company || '').toLowerCase());
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onMouseDown={e => { e.preventDefault(); pickOwner(p.company); setPeOpen(false); }}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', width: '100%', padding: '0.4rem 0.75rem', border: 'none', background: isPicked ? '#EFF6FF' : '#fff', textAlign: 'left', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit', color: '#1E293B' }}
                              onMouseEnter={e => { if (!isPicked) e.currentTarget.style.background = '#F8FAFC'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = isPicked ? '#EFF6FF' : '#fff'; }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.company}</span>
                              {isPE && <span style={{ flexShrink: 0, fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: '#F3E8FF', color: '#7C3AED' }}>PE</span>}
                            </button>
                          );
                        })}
                        {!q && allCompanies.length > 50 && (
                          <div style={{ padding: '0.35rem 0.75rem', fontSize: '0.65rem', color: '#94A3B8', fontStyle: 'italic', borderTop: '1px solid #F1F5F9' }}>
                            Showing first 50 of {allCompanies.length}. Type to narrow.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className={styles.wideField}>
              <label className={styles.label}>Email Domains</label>
              {(() => {
                const domains = (fields.emailDomain || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', padding: '0.4rem', border: '1px solid var(--color-border)', borderRadius: '6px', minHeight: '36px', alignItems: 'center' }}>
                    {domains.map((d, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.5rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '999px', fontSize: '0.72rem', color: '#1E40AF' }}>
                        {d}
                        <button
                          type="button"
                          onClick={() => {
                            const next = domains.filter((_, j) => j !== i);
                            set('emailDomain', next.join('\n'));
                          }}
                          style={{ background: 'none', border: 'none', color: '#93C5FD', fontSize: '0.8rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                        >&times;</button>
                      </span>
                    ))}
                    <input
                      type="text"
                      placeholder={domains.length === 0 ? 'firstname.lastname@domain.com' : '+ Add domain'}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && e.target.value.trim()) {
                          e.preventDefault();
                          const val = e.target.value.trim();
                          if (!domains.includes(val)) {
                            set('emailDomain', [...domains, val].join('\n'));
                          }
                          e.target.value = '';
                        }
                      }}
                      style={{ border: 'none', outline: 'none', fontSize: '0.78rem', fontFamily: 'inherit', color: 'var(--color-text)', padding: '0.15rem 0', minWidth: '140px', flex: '1 1 140px', background: 'none' }}
                    />
                  </div>
                );
              })()}
            </div>

            <div className={styles.wideField}>
              <label className={styles.label}>Also Known As <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(former names / rebrands)</span></label>
              {(() => {
                const aliases = (fields.aliases || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', padding: '0.4rem', border: '1px solid var(--color-border)', borderRadius: '6px', minHeight: '36px', alignItems: 'center' }}>
                    {aliases.map((a, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.5rem', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: '999px', fontSize: '0.72rem', color: '#5B21B6' }}>
                        {a}
                        <button
                          type="button"
                          onClick={() => {
                            const next = aliases.filter((_, j) => j !== i);
                            set('aliases', next.join('\n'));
                          }}
                          style={{ background: 'none', border: 'none', color: '#C4B5FD', fontSize: '0.8rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                        >&times;</button>
                      </span>
                    ))}
                    <input
                      type="text"
                      placeholder={aliases.length === 0 ? 'e.g. Andmore' : '+ Add former name'}
                      title="Other names this company has gone by (e.g. after a rebrand). Decision-maker contacts whose HubSpot Company matches one of these will surface as Key Contacts for this company."
                      onKeyDown={e => {
                        if (e.key === 'Enter' && e.target.value.trim()) {
                          e.preventDefault();
                          const val = e.target.value.trim();
                          if (!aliases.includes(val)) {
                            set('aliases', [...aliases, val].join('\n'));
                          }
                          e.target.value = '';
                        }
                      }}
                      onBlur={e => {
                        // Commit a typed-but-not-Entered value on blur too, so
                        // clicking away or closing the modal still saves it
                        // (the form autosaves fields, but only what's committed).
                        const val = e.target.value.trim();
                        if (val && !aliases.includes(val)) {
                          set('aliases', [...aliases, val].join('\n'));
                        }
                        e.target.value = '';
                      }}
                      style={{ border: 'none', outline: 'none', fontSize: '0.78rem', fontFamily: 'inherit', color: 'var(--color-text)', padding: '0.15rem 0', minWidth: '140px', flex: '1 1 140px', background: 'none' }}
                    />
                  </div>
                );
              })()}
            </div>

            <div className={styles.sectionHead}>Classification</div>

            <div>
              <label className={styles.label}>Type</label>
              <select className={styles.select} value={fields.type} onChange={e => set('type', e.target.value)}>
                <option value="">-</option>
                {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {fields.type === 'Private Equity' && (
              <div>
                <label className={styles.label}>PE Stage</label>
                <select className={styles.select} value={fields.peStage || ''} onChange={e => set('peStage', e.target.value)}>
                  <option value="">-</option>
                  {PE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className={styles.label}>Tier</label>
              <select className={styles.select} value={fields.tier} onChange={e => set('tier', e.target.value)}>
                <option value="">-</option>
                {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>Status</label>
              <select className={styles.select} value={fields.status} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>Geography</label>
              <select className={styles.select} value={fields.geography} onChange={e => set('geography', e.target.value)}>
                <option value="">-</option>
                {GEOGRAPHIES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>HQ Region</label>
              <select className={styles.input} value={fields.hqRegion} onChange={e => set('hqRegion', e.target.value)}>
                <option value="">-</option>
                <option value="North America">North America</option>
                <option value="Outside of North America">Outside of North America</option>
              </select>
            </div>

            <div>
              <label className={styles.label}>Public / Private</label>
              <select className={styles.select} value={fields.publicPrivate} onChange={e => set('publicPrivate', e.target.value)}>
                <option value="">-</option>
                {PUBLIC_PRIVATE.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div className={styles.sectionHead}>Coverage</div>

            <div>
              <label className={styles.label}>CDM</label>
              <SearchableSelect
                options={cdmOptions}
                value={fields.cdm || ''}
                onChange={v => set('cdm', v)}
                placeholder="Select CDM…"
              />
            </div>

            <div>
              <label
                className={styles.label}
                title="Who manages this client. Shared with the Clients page: editing it here changes it there too."
              >Client Manager</label>
              <input
                className={styles.input}
                type="text"
                value={cmDraft}
                placeholder={fields.company ? '-' : 'Name the company first'}
                disabled={!fields.company}
                onChange={e => setCmDraft(e.target.value)}
                onBlur={commitClientManager}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                  else if (e.key === 'Escape') {
                    e.preventDefault();
                    cmCancelled.current = true;
                    setCmDraft(clientManager || '');
                    e.currentTarget.blur();
                  }
                }}
                style={{
                  background: cmDraft ? '#F0FDF4' : 'var(--color-bg)',
                  color: cmDraft ? '#166534' : 'var(--color-text)',
                  fontWeight: cmDraft ? 600 : 400,
                }}
              />
            </div>

            <div>
              <label
                className={styles.label}
                title="Who partners with you on this company's opportunities. Suggestions are the Sales Partners already named on Opps 2 rows; type any other name to add one."
              >Sales Partner</label>
              {/* Control + hint share the value column — a third child of the
                  row grid would drop the hint under the label instead. */}
              <div>
                <SearchableSelect
                  options={salesPartnerOptions}
                  value={fields.salesPartner || ''}
                  onChange={v => set('salesPartner', v)}
                  placeholder="Add a sales partner…"
                />
                <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.3 }}>
                  Partners with you on this company&apos;s opps.
                </div>
              </div>
            </div>

            <div>
              <label className={styles.label}>Case Study Created?</label>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', padding: '0.25rem 0' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: '#1E293B', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name={`caseStudyCreated-${fields.id || 'new'}`}
                    checked={fields.caseStudyCreated === true}
                    onChange={() => set('caseStudyCreated', true)}
                    style={{ accentColor: '#10B981' }}
                  />
                  Yes
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: '#1E293B', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name={`caseStudyCreated-${fields.id || 'new'}`}
                    checked={fields.caseStudyCreated === 'in-progress'}
                    onChange={() => set('caseStudyCreated', 'in-progress')}
                    style={{ accentColor: '#F59E0B' }}
                  />
                  In Progress
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: '#1E293B', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name={`caseStudyCreated-${fields.id || 'new'}`}
                    checked={!fields.caseStudyCreated}
                    onChange={() => set('caseStudyCreated', false)}
                    style={{ accentColor: '#94A3B8' }}
                  />
                  No
                </label>
              </div>
            </div>

            <div>
              <label className={styles.label}>Acquisition News</label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', padding: '0.25rem 0', fontSize: '0.78rem', color: '#1E293B', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={fields.trackAcquisitionNews === true}
                  onChange={e => set('trackAcquisitionNews', e.target.checked)}
                  style={{ accentColor: '#7C3AED', marginTop: 2 }}
                />
                <span>
                  Track acquisition news
                  <span style={{ display: 'block', fontSize: '0.6rem', color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.3 }}>
                    Include this company in the weekly acquisition-news email — deals it
                    makes, and for a PE firm its portfolio add-ons too.
                  </span>
                </span>
              </label>
            </div>

            <div className={styles.sectionHead}>Scale</div>

            <div>
              <label className={styles.label}>Revenue</label>
              <CommitOnBlurInput className={styles.input} value={fields.revenue ?? ''} onCommit={v => set('revenue', v)} placeholder="e.g. $1.5B" />
            </div>

            <div>
              <label className={styles.label}>Rank</label>
              <CommitOnBlurInput className={styles.input} value={fields.rank} onCommit={v => set('rank', v)} />
            </div>

            <div>
              <label className={styles.label}>Number of Sites</label>
              <CommitOnBlurInput className={styles.input} type="number" value={fields.numberOfSites ?? ''} onCommit={v => set('numberOfSites', v)} />
            </div>

            <div>
              <label className={styles.label}>Number of Accounts</label>
              <CommitOnBlurInput className={styles.input} type="number" value={fields.numberOfAccounts ?? ''} onCommit={v => set('numberOfAccounts', v)} />
            </div>

            <div>
              <label className={styles.label}>Est. Annual Data Deal</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                <input
                  className={styles.input}
                  style={{ background: '#F8FAFC', color: '#475569', fontWeight: 600, flex: '1 1 auto', minWidth: 0 }}
                  value={estAnnualDataDeal != null ? `$${estAnnualDataDeal.toLocaleString()}` : ''}
                  readOnly
                  placeholder="-"
                  title="Number of Accounts x $5 per account per month, over twelve months."
                />
                <span style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                  $5/acct/mo
                </span>
              </div>
            </div>

            <div>
              <label className={styles.label}>RE AUM (billions)</label>
              <CommitOnBlurInput className={styles.input} type="number" step="0.01" value={fields.reAum ?? ''} onCommit={v => set('reAum', v)} />
            </div>

            <div>
              <label className={styles.label}>PE AUM (billions)</label>
              <CommitOnBlurInput className={styles.input} type="number" step="0.01" value={fields.peAum ?? ''} onCommit={v => set('peAum', v)} />
            </div>

            <div className={styles.sectionHead}>Profile</div>

            <div className={styles.wideField}>
              <label className={styles.label}>Asset Types</label>
              <MultiSelectDropdown options={assetTypeOptions} selected={fields.assetTypes || []} onToggle={(val) => toggleArrayField('assetTypes', val)} />
            </div>

            <div className={styles.wideField}>
              <label className={styles.label}>Strategies</label>
              <TagMultiSelect
                options={strategyOptions}
                selected={fields.strategies || []}
                onToggle={(val) => toggleArrayField('strategies', val)}
                onAddNew={(val) => persistCustomStrategy(val, settings, updateSettings)}
                placeholder="Tag this firm's investment strategies…"
              />
            </div>

            <div className={styles.wideField}>
              <label className={styles.label}>Frameworks</label>
              <MultiSelectDropdown options={FRAMEWORKS} selected={effectiveFrameworks} onToggle={toggleFramework} sourceOf={frameworkSourceOf} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: 4, fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>
                {Object.entries(FRAMEWORK_SOURCE_BADGES).map(([k, b]) => (
                  <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title={b.title}>
                    <span style={{ display: 'inline-block', padding: '0 5px', borderRadius: 999, fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', background: b.bg, color: b.text }}>{b.label}</span>
                    <span>{k === 'auto' ? 'from Lists mapping' : k === 'claude' ? 'from Claude research' : 'added here'}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Competitors — full width like the other Profile fields, one
                short single-line-ish editor. Free text with @[Service]
                tokens via the shared ScopingNotesEditor; the legacy
                structured fields.competitors map is kept on the record
                untouched so historical data still round-trips. */}

            {!isNew && (
              <div className={styles.wideField}>
                <label className={styles.label}>Competitors</label>
                <ScopingNotesEditor
                  value={fields.competitorsNotes || ''}
                  onCommit={v => set('competitorsNotes', v)}
                  services={SERVICE_CATEGORIES.flatMap(c => c.items)}
                  placeholder="Who's competing here? Type @ to tag a service: e.g. @strategic sourcing."
                  style={{ minHeight: '34px', padding: '0.3rem 0.5rem', fontSize: '0.78rem' }}
                />
              </div>
            )}

            <div className={styles.sectionHead}>Notes</div>

            <div className={styles.fieldFull}>
              <label className={styles.label}>Company Notes</label>
              <CommitOnBlurInput multiline autoGrow className={styles.textarea} value={fields.notes} onCommit={v => set('notes', v)} rows={2} />
            </div>

            <div className={styles.fieldFull}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <label className={styles.label}>Sustainability Targets</label>
                {/* Whether the company actually discloses, read straight off
                    the Frameworks selection above. A target means something
                    different depending on whether there's an audited report
                    behind it, so the two belong next to each other — and the
                    Corporate Compliance screener shows the same pair. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
                  {reportingStatus(effectiveFrameworks).map(({ label, reported, name }) => {
                    const c = reported ? REPORTED_COLORS : NOT_REPORTED_COLORS;
                    return (
                      <span
                        key={label}
                        title={`${name} — ${reported ? 'reported' : 'not reported'}. Set on the Frameworks field above.`}
                        style={{
                          fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.35rem',
                          borderRadius: 4, whiteSpace: 'nowrap',
                          background: c.bg, color: c.text, border: `1px solid ${c.border}`,
                        }}
                      >{reported ? '\u2713' : '\u2013'} {label}</span>
                    );
                  })}
                </div>
                {fields.company && (
                  <button
                    type="button"
                    onClick={runSustainabilityResearch}
                    disabled={sustainResearch.loading}
                    title={`Ask Claude to research ${fields.company}'s sustainability program, targets, frameworks, and ESG reports`}
                    style={{ padding: '0.2rem 0.55rem', border: '1px solid #BBF7D0', borderRadius: 6, background: sustainResearch.loading ? '#F0FDF4' : '#DCFCE7', color: '#15803D', fontSize: '0.68rem', fontWeight: 700, cursor: sustainResearch.loading ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  >{sustainResearch.loading ? 'Researching…' : 'Research with Claude'}</button>
                )}
              </div>
              <CommitOnBlurInput
                multiline
                autoGrow
                className={styles.textarea}
                value={fields.sustainabilityTargets || ''}
                onCommit={v => set('sustainabilityTargets', v)}
                rows={2}
                placeholder={'One per line, e.g.\nNet zero by 2050\n50% emissions reduction by 2030 vs 2019 baseline\n100% renewable electricity by 2025'}
              />
              <SustainabilityResearchPanel
                state={sustainResearch}
                onClear={clearSustainResearch}
                onUseTargets={() => {
                  const lines = (sustainResearch.data?.targets || []).join('\n');
                  if (!lines) return;
                  const current = (fields.sustainabilityTargets || '').trim();
                  set('sustainabilityTargets', current ? `${current}\n${lines}` : lines);
                }}
                onMergeFrameworks={() => {
                  const found = sustainResearch.data?.frameworks || [];
                  if (!found.length) return;
                  setFields(prev => {
                    const existing = new Set(prev.frameworks || []);
                    const sources = { ...(prev.frameworkSources || {}) };
                    for (const f of found) {
                      // Only newly-added frameworks are tagged 'claude'; ones
                      // the user already had keep their existing provenance.
                      if (!existing.has(f)) { existing.add(f); sources[f] = 'claude'; }
                    }
                    return { ...prev, frameworks: [...existing], frameworkSources: sources };
                  });
                }}
              />
            </div>
          </div>

          {/* Opportunities — bucketed notes pages, per-company, synced across devices */}
          {!isNew && fields.company?.trim() && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setOpportunitiesOpen(o => !o)}
              >
                <label className={styles.label} style={{ margin: 0, cursor: 'pointer' }}>
                  Notes
                </label>
                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', transform: opportunitiesOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>&#9660;</span>
                {(() => {
                  const n = (companyOppsData.opportunities || []).length;
                  return n > 0 ? <span style={{ fontSize: '0.68rem', color: '#64748B' }}>{n} {n === 1 ? 'note page' : 'note pages'}</span> : null;
                })()}
              </div>
              {opportunitiesOpen && (() => {
                const formNotes = (companyOppsData.opportunities || []).filter(o => o.type === 'form');
                return (
                <div style={{ marginTop: '0.75rem' }}>
                  {/* Chrome-style tabs bar for form-type note pages */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, borderBottom: '1px solid var(--color-border-light)', marginBottom: '0.75rem', overflowX: 'auto' }}>
                    {formNotes.map(note => {
                      const isActive = note.id === selectedOppId;
                      return (
                        <div
                          key={note.id}
                          onClick={() => setSelectedOppId(note.id)}
                          onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); renameOpportunity(note.id); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.3rem',
                            padding: '0.35rem 0.6rem 0.35rem 0.75rem',
                            border: '1px solid var(--color-border-light)',
                            borderBottom: isActive ? '1px solid #fff' : '1px solid var(--color-border-light)',
                            borderTopLeftRadius: 8, borderTopRightRadius: 8,
                            background: isActive ? '#fff' : '#F1F5F9',
                            color: isActive ? '#1E293B' : '#64748B',
                            fontSize: '0.78rem',
                            fontWeight: isActive ? 600 : 500,
                            cursor: 'pointer',
                            position: 'relative',
                            top: 1,
                            minWidth: 120, maxWidth: 220,
                            whiteSpace: 'nowrap',
                            userSelect: 'none',
                          }}
                          title={(note.title || 'New form') + ' · double-click or ✎ to rename'}
                        >
                          {renamingOppId === note.id ? (
                            <InlineRenameInput
                              initial={note.title || ''}
                              onSubmit={(v) => commitOppRename(note.id, v)}
                              onCancel={cancelOppRename}
                            />
                          ) : (
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {note.title || 'New form'}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); renameOpportunity(note.id); }}
                            title="Rename tab"
                            style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: '0.75rem', cursor: 'pointer', padding: '0 0.2rem', lineHeight: 1 }}
                          >✎</button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); deleteOpportunity(note.id); }}
                            title="Close tab"
                            style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', padding: '0 0.2rem', lineHeight: 1 }}
                          >×</button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => addOpportunityForm(null)}
                      title="New form tab"
                      style={{ padding: '0.35rem 0.6rem', background: 'transparent', border: 'none', color: '#64748B', fontSize: '1rem', fontWeight: 700, cursor: 'pointer' }}
                    >+</button>
                  </div>

                  {selectedOpp ? (
                    // Detail view — editing a single opportunity
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedOppId(null)}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Hide
                        </button>
                        <div style={{ flex: 1 }} />
                        <select
                          value={selectedOpp.bucketId}
                          onChange={e => moveOpportunity(selectedOpp.id, e.target.value)}
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: 4 }}
                        >
                          {(companyOppsData.buckets || []).map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => renameOpportunity(selectedOpp.id)}
                          style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Rename
                        </button>
                        {selectedOpp.type !== 'form' && (
                          <>
                            <input
                              ref={oppDocxInputRef}
                              type="file"
                              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                              onChange={handleOppDocxUpload}
                              style={{ display: 'none' }}
                            />
                            <button
                              type="button"
                              onClick={() => oppDocxInputRef.current?.click()}
                              title="Upload a Word document (.docx) into this opportunity's notes"
                              style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                            >
                              Upload .docx
                            </button>
                            <button
                              type="button"
                              onClick={downloadOppAsDocx}
                              title="Download this opportunity's notes as a Word document"
                              style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                            >
                              Download .docx
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => deleteOpportunity(selectedOpp.id)}
                          style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={openOppFollowUpEmail}
                          title="Open Outlook with a follow-up email summarizing the Action Items / Next Steps"
                          style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', border: '1px solid #0078D4', background: '#EFF6FF', color: '#0078D4', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                        >
                          ✉ Follow-Up Email
                        </button>
                      </div>
                      {selectedOpp.type === 'form' ? (
                        <OpportunityForm
                          value={selectedOpp.formData}
                          importableNotes={importableNotes}
                          companyBackground={sustainResearch?.data || null}
                          onChange={(next) => updateOpportunityFormData(selectedOpp.id, next)}
                          onLinkOpp={(_opp, nextFormData) => {
                            // Persist the linked formData without touching
                            // the tab title — title is manually set by the
                            // user and should not auto-fill from the service.
                            const now = Date.now();
                            writeCompanyOpps({
                              buckets: companyOppsData.buckets || [],
                              opportunities: (companyOppsData.opportunities || []).map(o => (
                                o.id !== selectedOpp.id ? o : { ...o, formData: nextFormData || o.formData, updatedAt: now }
                              )),
                            });
                          }}
                          companyName={fields.company}
                          companyContacts={companyContacts}
                          allHubspotContacts={hubspotContacts}
                          serviceQuestionsOverride={settings.serviceQuestions || null}
                          serviceTheirQuestionsOverride={settings.serviceTheirQuestions || null}
                          contactNotes={settings.contactNotes || {}}
                          contactReportsTo={settings.contactReportsTo || {}}
                          contactNicknames={settings.contactNicknames || {}}
                          prospects={prospects}
                          cdmName={cdmName}
                          competitorOptions={competitorOptions}
                          onMentionCompetitor={(name, recentService) => {
                            // Append the just-mentioned competitor to
                            // the Competitors box (fields.competitorsNotes)
                            // so it shows up at the top of the popup.
                            // Pair it with the most recent in-line
                            // service mention when one was nearby.
                            const tokenComp = `@![${name}]`;
                            const tokenSvc = recentService ? ` @[${recentService}]` : '';
                            const cur = String(fields.competitorsNotes || '').trim();
                            // Skip when the same pair already exists
                            // verbatim — keeps repeated typing of the
                            // same name in different notes from
                            // duplicating the entry.
                            const candidate = `${tokenComp}${tokenSvc}`;
                            if (cur.includes(candidate)) return;
                            const next = cur ? `${cur}\n${candidate}` : candidate;
                            set('competitorsNotes', next);
                          }}
                          onOpenContact={(contact) => { if (contact) setEditingContact(contact); }}
                          onCreateContact={async ({ email, firstname, lastname }) => {
                            try {
                              const properties = { email };
                              if (firstname) properties.firstname = firstname;
                              if (lastname) properties.lastname = lastname;
                              if (fields.company) properties.company = fields.company;
                              const res = await apiFetch('/api/hubspot?action=create-contact', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ properties }),
                              });
                              const data = await res.json();
                              if (!data.success || !data.contact) {
                                alert('Failed to create HubSpot contact' + (data.error ? `: ${data.error}` : ''));
                                return;
                              }
                              // Upsert into the local HubSpot cache: if a
                              // contact with this id (or email) is already
                              // there, replace it; otherwise append. This
                              // handles the 409-recovered path where the
                              // server returned an existing contact.
                              try {
                                await updateHubspotCache(draft => {
                                  const incomingEmail = (data.contact.email || '').toLowerCase();
                                  const idx = draft.contacts.findIndex(c =>
                                    (c.id && c.id === data.contact.id) ||
                                    (incomingEmail && (c.email || '').toLowerCase() === incomingEmail)
                                  );
                                  if (idx >= 0) draft.contacts[idx] = { ...draft.contacts[idx], ...data.contact };
                                  else draft.contacts.push(data.contact);
                                });
                              } catch {}
                              if (data.alreadyExisted) {
                                console.log(`HubSpot contact already existed (id ${data.contact.id}); pulled into local cache.`);
                              }
                            } catch (err) {
                              alert('Failed to create HubSpot contact: ' + (err.message || err));
                            }
                          }}
                        />
                      ) : (
                        <div className="opportunity-notes-editor">
                          <ReactQuill
                            ref={oppQuillRef}
                            theme="snow"
                            value={oppNoteDraft}
                            onChange={handleOppNoteChange}
                            placeholder="Notes for this opportunity…"
                            modules={{
                              toolbar: [
                                [{ 'header': [1, 2, 3, false] }],
                                ['bold', 'italic', 'underline', 'strike'],
                                [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'list': 'check' }],
                                ['link', 'blockquote', 'code-block'],
                                ['clean'],
                              ],
                              clipboard: { matchVisual: false },
                            }}
                            formats={['header', 'bold', 'italic', 'underline', 'strike', 'list', 'indent', 'link', 'blockquote', 'code-block']}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    // Overview — buckets + opportunity cards
                    <div>
                      <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1 }} />
                        <input
                          ref={templateFileInputRef}
                          type="file"
                          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          onChange={handleTemplateUpload}
                          style={{ display: 'none' }}
                        />
                        <span style={{ fontSize: '0.68rem', color: '#64748B', marginRight: '0.15rem' }}>
                          Template{customOpportunityTemplate ? ' (custom)' : ''}:
                        </span>
                        <button
                          type="button"
                          onClick={downloadOpportunityTemplate}
                          title="Download the current opportunity template as a Word document"
                          style={{ fontSize: '0.7rem', padding: '0.25rem 0.55rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Download .docx
                        </button>
                        <button
                          type="button"
                          onClick={() => templateFileInputRef.current?.click()}
                          title="Upload a Word document to use as the template for new opportunities"
                          style={{ fontSize: '0.7rem', padding: '0.25rem 0.55rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Upload .docx
                        </button>
                        {customOpportunityTemplate && (
                          <button
                            type="button"
                            onClick={resetOpportunityTemplate}
                            title="Reset to the built-in default template"
                            style={{ fontSize: '0.7rem', padding: '0.25rem 0.55rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 4, cursor: 'pointer' }}
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      {(companyOppsData.buckets || []).length === 0 ? (
                        <div style={{ fontSize: '0.78rem', color: '#64748B', fontStyle: 'italic', padding: '0.5rem 0' }}>
                          No buckets yet. Add one to start grouping opportunities.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {(companyOppsData.buckets || []).map(bucket => {
                            const bucketOpps = (companyOppsData.opportunities || []).filter(o => o.bucketId === bucket.id);
                            return (
                              <div key={bucket.id} style={{ border: '1px solid var(--color-border-light)', borderRadius: 6, padding: '0.6rem 0.75rem', background: '#F8FAFC' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                  <input
                                    type="text"
                                    value={bucket.name}
                                    onChange={e => renameBucketTo(bucket.id, e.target.value)}
                                    placeholder="Bucket name…"
                                    autoFocus={!bucket.name}
                                    style={{ fontWeight: 600, fontSize: '0.82rem', color: '#334155', border: '1px solid transparent', padding: '0.2rem 0.4rem', borderRadius: 4, background: 'transparent', fontFamily: 'inherit', minWidth: 120, flex: '0 1 260px' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                  <span style={{ fontSize: '0.68rem', color: '#64748B' }}>{bucketOpps.length}</span>
                                  <div style={{ flex: 1 }} />
                                  <button
                                    type="button"
                                    onClick={() => addOpportunity(bucket.id)}
                                    style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                                  >
                                    + Opportunity
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => addOpportunityForm(bucket.id)}
                                    title="Create a structured form page that pulls data from an opp row and exports to Excel"
                                    style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                                  >
                                    + Form
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteBucket(bucket.id)}
                                    style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 4, cursor: 'pointer' }}
                                  >
                                    Delete
                                  </button>
                                </div>
                                {bucketOpps.length === 0 ? (
                                  <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic' }}>No opportunities in this bucket.</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                    {bucketOpps.map(opp => {
                                      const preview = (opp.notes || '').replace(/<[^>]*>/g, '').trim().slice(0, 80);
                                      return (
                                        <div
                                          key={opp.id}
                                          onClick={() => setSelectedOppId(opp.id)}
                                          style={{ background: 'white', border: '1px solid var(--color-border-light)', borderRadius: 4, padding: '0.4rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                        >
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.78rem', color: '#1E293B' }}>{opp.title}</div>
                                            {preview && (
                                              <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</div>
                                            )}
                                          </div>
                                          <span style={{ fontSize: '0.6rem', color: '#94A3B8' }}>&rsaquo;</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })()}
            </div>
          )}

          {/* Opportunities — simple flat list of deals/opportunities for this company.
              Hidden per user request — flip the false below to bring it back. */}
          {false && !isNew && fields.company?.trim() && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setDealsOpen(o => !o)}
              >
                <label className={styles.label} style={{ margin: 0, cursor: 'pointer' }}>
                  Opportunities
                </label>
                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', transform: dealsOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>&#9660;</span>
                {companyDeals.length > 0 && (
                  <span style={{ fontSize: '0.68rem', color: '#64748B' }}>{companyDeals.length} {companyDeals.length === 1 ? 'opportunity' : 'opportunities'}</span>
                )}
              </div>
              {dealsOpen && (
                <div style={{ marginTop: '0.6rem' }}>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); addDeal(); }}
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                    >+ Opportunity</button>
                  </div>
                  {companyDeals.length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: '#64748B', fontStyle: 'italic', padding: '0.5rem 0' }}>
                      No opportunities yet. Click + Opportunity to add one.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {companyDeals.map(d => (
                        <div key={d.id} style={{ border: '1px solid var(--color-border-light)', borderRadius: 6, padding: '0.6rem 0.75rem', background: '#F8FAFC' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'center' }}>
                            <input
                              type="text"
                              value={d.title}
                              onChange={e => updateDeal(d.id, { title: e.target.value })}
                              placeholder="Opportunity title…"
                              style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.8rem', fontFamily: 'inherit', fontWeight: 600 }}
                            />
                            <select
                              value={d.stage || 'New'}
                              onChange={e => updateDeal(d.id, { stage: e.target.value })}
                              style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'inherit', background: 'white' }}
                            >
                              {DEAL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={d.value}
                              onChange={e => updateDeal(d.id, { value: e.target.value })}
                              placeholder="$ value"
                              style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'inherit' }}
                            />
                            <input
                              type="date"
                              value={d.closeDate}
                              onChange={e => updateDeal(d.id, { closeDate: e.target.value })}
                              style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'inherit' }}
                            />
                            <button
                              type="button"
                              onClick={() => deleteDeal(d.id)}
                              title="Delete opportunity"
                              style={{ padding: '0.25rem 0.5rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 4, cursor: 'pointer', fontSize: '0.72rem' }}
                            >×</button>
                          </div>
                          <textarea
                            value={d.description}
                            onChange={e => updateDeal(d.id, { description: e.target.value })}
                            placeholder="Description / notes…"
                            rows={2}
                            style={{ width: '100%', marginTop: '0.4rem', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Services Explored */}
          {!isNew && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setServicesOpen(o => !o)}
              >
                <label className={styles.label} style={{ margin: 0, cursor: 'pointer' }}>
                  Services Explored
                </label>
                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', transform: servicesOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>&#9660;</span>
                {(() => {
                  const svc = fields.servicesExplored || {};
                  const hidden = new Set(settings.hiddenServices || []);
                  const totalItems = SERVICE_CATEGORIES.reduce((sum, cat) => sum + cat.items.filter(i => !hidden.has(i)).length, 0);
                  const exploredItems = new Set();
                  for (const [item, val] of Object.entries(svc)) {
                    if (val && val !== '-' && !hidden.has(item)) exploredItems.add(item);
                  }
                  for (const item of scopeMatchedServices.keys()) {
                    if (!hidden.has(item)) exploredItems.add(item);
                  }
                  const pct = totalItems > 0 ? Math.round((exploredItems.size / totalItems) * 100) : 0;
                  return (
                    <>
                      <span style={{ fontSize: '0.68rem', color: '#64748B', fontWeight: 600 }}>
                        {exploredItems.size}/{totalItems} ({pct}%)
                      </span>
                      {/* Queued opps aren't explored yet, so they stay out
                          of the count above and get their own badge. */}
                      {scheduledServices.size > 0 && (
                        <span
                          title="Services with a New Opp already scheduled for this company. Nothing exists on the Opps table until it fires."
                          style={{
                            fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                            background: SCHEDULED_OPP_COLORS.bg, color: SCHEDULED_OPP_COLORS.color,
                            border: `1px solid ${SCHEDULED_OPP_COLORS.border}`,
                          }}
                        >{scheduledServices.size} scheduled</span>
                      )}
                    </>
                  );
                })()}
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const svc = fields.servicesExplored || {};
                    const svcNotes = fields.serviceNotes || {};
                    const svcSMEs = fields.serviceSMEs || {};
                    const hidden = new Set(settings.hiddenServices || []);
                    const renames = settings.serviceRenames || {};
                    const categories = getServiceCategories(settings);
                    const SE_GREEN = 'FF3DCD58';
                    const SE_GREEN_DARK = 'FF009530';
                    const SE_TEXT_DARK = 'FF1E293B';
                    const SE_BORDER = 'FFD4DDE1';
                    const STATUS_FILL = {
                      'Sold': 'FFDCFCE7',
                      'Not Sold': 'FFFEE2E2',
                      'Renewal': 'FFDBEAFE',
                      'In Progress': 'FFFEF3C7',
                      'N/A': 'FFF1F5F9',
                    };
                    const STATUS_FG = {
                      'Sold': 'FF166534',
                      'Not Sold': 'FF991B1B',
                      'Renewal': 'FF1E40AF',
                      'In Progress': 'FF92400E',
                      'N/A': 'FF64748B',
                    };
                    try {
                      const { Workbook } = await import('exceljs');
                      const wb = new Workbook();
                      wb.creator = 'Schneider Electric · Prospect Tracker';
                      wb.created = new Date();
                      const ws = wb.addWorksheet('Services Explored', {
                        properties: { tabColor: { argb: SE_GREEN } },
                        views: [{ state: 'frozen', ySplit: 3 }],
                      });
                      const headers = ['Category', 'Service', 'Status', 'SME', 'Notes'];
                      const colWidths = [28, 40, 18, 24, 60];
                      ws.columns = colWidths.map(w => ({ width: w }));

                      ws.mergeCells(1, 1, 1, headers.length);
                      const titleCell = ws.getCell(1, 1);
                      titleCell.value = 'Schneider Electric';
                      titleCell.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
                      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
                      titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                      ws.getRow(1).height = 30;

                      ws.mergeCells(2, 1, 2, headers.length);
                      const subCell = ws.getCell(2, 1);
                      subCell.value = `${fields.company || 'Company'}  ·  Services Explored`;
                      subCell.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: 'FF64748B' } };
                      subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                      ws.getRow(2).height = 20;

                      const headerRow = ws.getRow(3);
                      headers.forEach((h, i) => {
                        const cell = headerRow.getCell(i + 1);
                        cell.value = h;
                        cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
                        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
                        cell.border = {
                          top: { style: 'thin', color: { argb: SE_BORDER } },
                          bottom: { style: 'thin', color: { argb: SE_BORDER } },
                          left: { style: 'thin', color: { argb: SE_BORDER } },
                          right: { style: 'thin', color: { argb: SE_BORDER } },
                        };
                      });
                      headerRow.height = 30;

                      let rowIdx = 4;
                      for (const cat of categories) {
                        const items = (cat.items || []).filter(it => !hidden.has(it));
                        if (items.length === 0) continue;
                        for (const item of items) {
                          const rawStatus = svc[item] || '';
                          const status = rawStatus && rawStatus !== '-' ? rawStatus : '';
                          const note = svcNotes[item] || '';
                          const sme = svcSMEs[item] || '';
                          const row = ws.getRow(rowIdx);
                          const display = renames[item] || item;
                          [cat.name, display, status, sme, note].forEach((v, i) => {
                            const cell = row.getCell(i + 1);
                            cell.value = v === '' || v == null ? null : v;
                            cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
                            cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: i === 4, indent: 1 };
                            cell.border = {
                              bottom: { style: 'thin', color: { argb: SE_BORDER } },
                              left: { style: 'thin', color: { argb: SE_BORDER } },
                              right: { style: 'thin', color: { argb: SE_BORDER } },
                            };
                            if (i === 2 && status && STATUS_FILL[status]) {
                              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[status] } };
                              cell.font = { ...cell.font, bold: true, color: { argb: STATUS_FG[status] } };
                            }
                          });
                          row.height = 18;
                          rowIdx += 1;
                        }
                      }

                      ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } };
                      colWidths.forEach((w, idx) => { ws.getColumn(idx + 1).width = w; });

                      sanitizeExcelWorkbook(wb);
                      const buf = await wb.xlsx.writeBuffer();
                      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                      const url = URL.createObjectURL(blob);
                      const safeCompany = (fields.company || 'Company').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${safeCompany} - Services Explored.xlsx`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    } catch (err) {
                      alert('Failed to export services: ' + (err.message || err));
                    }
                  }}
                  style={{ marginLeft: '0.5rem', padding: '0.15rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px', background: '#fff', fontSize: '0.62rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#059669' }}
                >Export Excel</button>
                <button
                  onClick={(e) => { e.stopPropagation(); setServicesEditMode(m => !m); }}
                  style={{ marginLeft: '0.4rem', padding: '0.15rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px', background: servicesEditMode ? '#FEF3C7' : 'var(--color-surface)', fontSize: '0.62rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: servicesEditMode ? '#92400E' : 'var(--color-text-muted)' }}
                >{servicesEditMode ? 'Done Editing' : 'Edit Services'}</button>
              </div>
              {servicesOpen && (() => {
                const serviceRenames = settings.serviceRenames || {};
                const hiddenServices = new Set(settings.hiddenServices || []);
                const hiddenCount = hiddenServices.size;
                const getDisplayName = (item) => serviceRenames[item] || item;

                // Use custom categories if saved, otherwise default
                const categories = getServiceCategories(settings);

                function saveCategories(next) {
                  updateSettings({ customServiceCategories: next });
                }
                function renameService(original, newName) {
                  const next = { ...(settings.serviceRenames || {}) };
                  if (newName === original || !newName.trim()) delete next[original];
                  else next[original] = newName.trim();
                  updateSettings({ serviceRenames: next });
                }
                function toggleHideService(item) {
                  const current = settings.hiddenServices || [];
                  const next = current.includes(item) ? current.filter(s => s !== item) : [...current, item];
                  updateSettings({ hiddenServices: next });
                }
                function renameCategoryBox(oldName, newName) {
                  if (!newName.trim() || newName === oldName) return;
                  const next = categories.map(c => c.name === oldName ? { ...c, name: newName.trim() } : c);
                  saveCategories(next);
                }
                function deleteCategoryBox(catName) {
                  if (!confirm(`Delete "${catName}" box? Its services will be hidden.`)) return;
                  const cat = categories.find(c => c.name === catName);
                  const next = categories.filter(c => c.name !== catName);
                  // Hide all items from the deleted category
                  if (cat) {
                    const hidden = [...(settings.hiddenServices || [])];
                    for (const item of cat.items) { if (!hidden.includes(item)) hidden.push(item); }
                    updateSettings({ hiddenServices: hidden, customServiceCategories: next });
                    return;
                  }
                  saveCategories(next);
                }
                function moveService(item, fromCat, toCat) {
                  if (fromCat === toCat) return;
                  const next = categories.map(c => {
                    if (c.name === fromCat) return { ...c, items: c.items.filter(i => i !== item) };
                    if (c.name === toCat) return { ...c, items: [...c.items, item] };
                    return c;
                  });
                  saveCategories(next);
                }

                return (
                <div>
                  {servicesEditMode && hiddenCount > 0 && (
                    <div style={{ marginTop: '0.5rem', marginBottom: '0.25rem', fontSize: '0.68rem', color: '#64748B' }}>
                      {hiddenCount} hidden service{hiddenCount !== 1 ? 's' : ''}
                    </div>
                  )}
                  <div style={{ marginTop: '0.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.4rem', maxHeight: '500px', overflowY: 'auto', padding: '0.15rem' }}>
                  {/* Names already assigned as an SME on this card, offered
                      as suggestions on every SME box below. */}
                  <datalist id="service-sme-names">
                    {[...new Set(Object.values(fields.serviceSMEs || {})
                      .map(v => String(v || '').trim()).filter(Boolean))]
                      .sort((a, b) => a.localeCompare(b))
                      .map(n => <option key={n} value={n} />)}
                  </datalist>
                  {categories.map(cat => {
                    const svc = fields.servicesExplored || {};
                    const visibleItems = servicesEditMode ? cat.items : cat.items.filter(item => !hiddenServices.has(item));
                    if (visibleItems.length === 0 && !servicesEditMode) return null;
                    return (
                      <div key={cat.name} style={{ breakInside: 'avoid', border: '1px solid var(--color-border)', borderRadius: '5px', overflow: 'hidden', fontSize: '0.72rem', marginBottom: '0.4rem' }}>
                        <div style={{ padding: '0.2rem 0.4rem', background: '#EFF6FF', borderBottom: '1px solid var(--color-border)', fontWeight: 700, fontSize: '0.65rem', color: '#1E40AF', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          {servicesEditMode && editingServiceName?.catName === cat.name ? (
                            <input
                              autoFocus
                              defaultValue={cat.name}
                              onBlur={(e) => { renameCategoryBox(cat.name, e.target.value); setEditingServiceName(null); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingServiceName(null); }}
                              style={{ flex: 1, fontSize: '0.65rem', fontWeight: 700, padding: '0 2px', border: '1px solid var(--color-accent)', borderRadius: '3px', fontFamily: 'inherit', outline: 'none', background: '#fff' }}
                              onClick={e => e.stopPropagation()}
                            />
                          ) : (
                            <span style={{ flex: 1, cursor: servicesEditMode ? 'pointer' : 'default' }} onClick={() => servicesEditMode && setEditingServiceName({ catName: cat.name })} title={servicesEditMode ? 'Click to rename' : ''}>
                              {cat.name}
                            </span>
                          )}
                          {servicesEditMode && (
                            <button
                              onClick={() => deleteCategoryBox(cat.name)}
                              style={{ background: 'none', border: 'none', color: '#FCA5A5', fontSize: '0.8rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                              onMouseEnter={e => e.target.style.color = '#EF4444'}
                              onMouseLeave={e => e.target.style.color = '#FCA5A5'}
                              title="Delete box"
                            >&times;</button>
                          )}
                        </div>
                        <div style={{ padding: '0.1rem 0' }}>
                          {visibleItems.map(item => {
                            const isHidden = hiddenServices.has(item);
                            const manualStatus = svc[item] || '-';
                            const oppStage = scopeMatchedServices.get(item);
                            let effectiveStatus = manualStatus;
                            if (manualStatus === '-' && oppStage) {
                              effectiveStatus = oppStage;
                            }
                            // A real value in servicesExplored is a manual
                            // override of the automatic (opp-derived) status.
                            // When set, surface a one-click "revert to auto"
                            // affordance so the user can drop back to the
                            // normal logic at the service level.
                            const isManualOverride = manualStatus !== '-';
                            // A service that already carried a status and now
                            // has an opp naming it too: back in play. Purely
                            // how the row is painted — the saved status below
                            // is untouched.
                            const retry = isTryingAgain(manualStatus, oppStage);
                            const colors = serviceStatusColor(effectiveStatus);
                            // An opp for this service is queued but not
                            // created yet: no row exists to give it a
                            // status, so it's a chip rather than a state.
                            const scheduledOpp = scheduledServices.get(item);

                            if (servicesEditMode) {
                              return (
                                <div key={item} style={{ display: 'flex', alignItems: 'center', padding: '0.1rem 0.35rem', gap: '0.25rem', opacity: isHidden ? 0.4 : 1 }}>
                                  {editingServiceName?.original === item ? (
                                    <input
                                      autoFocus
                                      defaultValue={getDisplayName(item)}
                                      onBlur={(e) => { renameService(item, e.target.value); setEditingServiceName(null); }}
                                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingServiceName(null); }}
                                      style={{ flex: 1, fontSize: '0.68rem', padding: '1px 4px', border: '1px solid var(--color-accent)', borderRadius: '3px', fontFamily: 'inherit', outline: 'none' }}
                                    />
                                  ) : (
                                    <span
                                      onClick={() => setEditingServiceName({ original: item })}
                                      style={{ flex: 1, fontSize: '0.68rem', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isHidden ? 'line-through' : 'none' }}
                                      title="Click to rename"
                                    >
                                      {getDisplayName(item)}
                                    </span>
                                  )}
                                  <select
                                    value={cat.name}
                                    onChange={e => moveService(item, cat.name, e.target.value)}
                                    title="Move to another box"
                                    style={{ fontSize: '0.55rem', padding: '0 1px', border: '1px solid var(--color-border)', borderRadius: '3px', background: 'var(--color-surface)', color: '#64748B', cursor: 'pointer', maxWidth: '55px', fontFamily: 'inherit' }}
                                  >
                                    {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                  </select>
                                  <button
                                    onClick={() => toggleHideService(item)}
                                    style={{ background: 'none', border: 'none', fontSize: '0.6rem', cursor: 'pointer', padding: '0 2px', color: isHidden ? '#22C55E' : '#94A3B8', fontFamily: 'inherit', fontWeight: 600 }}
                                    title={isHidden ? 'Show' : 'Hide'}
                                  >{isHidden ? '↩' : '✕'}</button>
                                </div>
                              );
                            }

                            const noteKey = item;
                            const noteVal = (fields.serviceNotes || {})[noteKey] || '';
                            const hasNote = !!noteVal;
                            const isNoteOpen = expandedServiceNote === noteKey;
                            const smeVal = (fields.serviceSMEs || {})[item] || '';
                            const isSMEOpen = expandedServiceSME === item;
                            return (
                              <div key={item}>
                                <div
                                  style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    // The category boxes sit in a narrow grid,
                                    // so the "Trying again" chip wraps to its
                                    // own line rather than squeezing the
                                    // service name out of the row.
                                    flexWrap: 'wrap',
                                    padding: '0.1rem 0.35rem', gap: '0.25rem',
                                    background: retry ? TRYING_AGAIN_COLORS.bg : (colors.bg || 'transparent'),
                                    // A retried service is the opposite of
                                    // dormant, so it keeps full weight even
                                    // when the saved status was N/A.
                                    opacity: !retry && effectiveStatus === 'N/A' ? 0.5 : 1,
                                  }}
                                >
                                  <span
                                    onClick={() => setExpandedServiceNote(isNoteOpen ? null : noteKey)}
                                    style={{ fontSize: '0.6rem', cursor: 'pointer', color: hasNote ? '#F59E0B' : '#CBD5E1', padding: '0 1px', lineHeight: 1, flexShrink: 0 }}
                                    title={hasNote ? noteVal : 'Add note'}
                                  >{hasNote ? '\u270E' : '\u270E'}</span>
                                  <span style={{ flex: 1, minWidth: '3.5rem', fontSize: '0.68rem', color: retry ? TRYING_AGAIN_COLORS.color : (colors.color || 'var(--color-text)'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item}>
                                    {getDisplayName(item)}
                                  </span>
                                  {/* SME — the Schneider contact who owns this
                                      service. The service boxes sit in a
                                      multi-column grid (~235px a row), so this
                                      is a compact chip rather than a text box;
                                      a full input here squeezed the service
                                      name down to ~45px. Click to edit below. */}
                                  <button
                                    type="button"
                                    onClick={() => setExpandedServiceSME(isSMEOpen ? null : item)}
                                    title={smeVal ? `SME: ${smeVal}` : 'Add the Schneider SME for this service'}
                                    style={{
                                      flexShrink: 0, maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap', fontSize: '0.55rem', fontWeight: 700,
                                      padding: '1px 3px', borderRadius: '3px', cursor: 'pointer',
                                      fontFamily: 'inherit', lineHeight: 1.4,
                                      border: `1px solid ${smeVal ? '#93C5FD' : 'var(--color-border)'}`,
                                      background: smeVal ? '#EFF6FF' : 'var(--color-surface)',
                                      color: smeVal ? '#1E40AF' : '#CBD5E1',
                                    }}
                                  >{smeVal ? smeInitials(smeVal) : 'SME'}</button>
                                  <select
                                    value={effectiveStatus}
                                    onChange={e => {
                                      const next = { ...(fields.servicesExplored || {}), [item]: e.target.value };
                                      if (e.target.value === '-') delete next[item];
                                      set('servicesExplored', next);
                                    }}
                                    title={isManualOverride
                                      ? `Manual override: ${manualStatus}.${oppStage ? ` Automatic status from a matching opp would be: ${oppStage}.` : ' No matching opp, so the automatic status is blank.'} Pick "- (auto)" or click ↺ to revert to the automatic status.`
                                      : oppStage ? `Automatic status from a matching opp: ${oppStage}. Pick a status to set a manual override.` : 'No manual override and no matching opp.'}
                                    style={{
                                      fontSize: '0.62rem', padding: '1px 2px', border: `1px solid ${isManualOverride ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                      borderRadius: '3px', background: colors.bg || 'var(--color-surface)', color: colors.color || 'var(--color-text)',
                                      cursor: 'pointer', minWidth: '65px', fontFamily: 'inherit', fontWeight: 600,
                                    }}
                                  >
                                    {SERVICE_STATUSES.map(s => <option key={s} value={s}>{s === '-' ? '- (auto)' : s}</option>)}
                                  </select>
                                  {isManualOverride && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const next = { ...(fields.servicesExplored || {}) };
                                        delete next[item];
                                        set('servicesExplored', next);
                                      }}
                                      title="Clear manual override: revert this service to the automatic (opp-based) status"
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '0.72rem', padding: '0 1px', lineHeight: 1, flexShrink: 0 }}
                                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-accent)'; }}
                                      onMouseLeave={e => { e.currentTarget.style.color = '#94A3B8'; }}
                                    >↺</button>
                                  )}
                                  {/* Last in the row so it is the chip that
                                      wraps when the box is narrow — the
                                      status controls stay on line one. */}
                                  {retry && (
                                    <span
                                      title={tryingAgainTitle(manualStatus, oppStage)}
                                      style={{
                                        flexShrink: 0, fontSize: '0.55rem', fontWeight: 700,
                                        padding: '1px 3px', borderRadius: '3px', lineHeight: 1.4,
                                        whiteSpace: 'nowrap',
                                        background: TRYING_AGAIN_COLORS.bg, color: TRYING_AGAIN_COLORS.color,
                                        border: `1px solid ${TRYING_AGAIN_COLORS.border}`,
                                      }}
                                    >{TRYING_AGAIN}</span>
                                  )}
                                  {scheduledOpp && (
                                    <span
                                      title={scheduledOppChipTitle(scheduledOpp, getDisplayName(item))}
                                      style={{
                                        flexShrink: 0, fontSize: '0.55rem', fontWeight: 700,
                                        padding: '1px 3px', borderRadius: '3px', lineHeight: 1.4,
                                        whiteSpace: 'nowrap',
                                        background: SCHEDULED_OPP_COLORS.bg, color: SCHEDULED_OPP_COLORS.color,
                                        border: `1px solid ${SCHEDULED_OPP_COLORS.border}`,
                                      }}
                                    >Opp {formatScheduledOppDay(scheduledOpp)}</span>
                                  )}
                                </div>
                                {isSMEOpen && (
                                  <div style={{ padding: '0.15rem 0.35rem 0.25rem 1.2rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                    <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--color-text-muted)', flexShrink: 0 }}>SME</span>
                                    <input
                                      type="text"
                                      autoFocus
                                      list="service-sme-names"
                                      defaultValue={smeVal}
                                      placeholder="Schneider contact"
                                      onBlur={e => {
                                        const v = e.target.value.trim();
                                        if (v === smeVal) return;
                                        const next = { ...(fields.serviceSMEs || {}) };
                                        if (v) next[item] = v; else delete next[item];
                                        set('serviceSMEs', next);
                                      }}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') { e.currentTarget.blur(); setExpandedServiceSME(null); }
                                        else if (e.key === 'Escape') { e.currentTarget.value = smeVal; setExpandedServiceSME(null); }
                                      }}
                                      style={{
                                        flex: 1, minWidth: 0, fontSize: '0.62rem', padding: '1px 3px',
                                        border: '1px solid var(--color-accent)', borderRadius: '3px',
                                        background: '#fff', color: 'var(--color-text)', fontFamily: 'inherit',
                                      }}
                                    />
                                  </div>
                                )}
                                {isNoteOpen && (
                                  <div style={{ padding: '0.15rem 0.35rem 0.25rem 1.2rem' }}>
                                    <ScopingNotesEditor
                                      value={noteVal}
                                      onCommit={v => {
                                        const next = { ...(fields.serviceNotes || {}) };
                                        if (v && v.trim()) next[noteKey] = v;
                                        else delete next[noteKey];
                                        set('serviceNotes', next);
                                      }}
                                      services={SERVICE_CATEGORIES.flatMap(c => c.items)}
                                      competitors={competitorOptions}
                                      onMentionCompetitor={(name, recentService) => {
                                        // Service notes already have a
                                        // service context (the row's
                                        // service); use it as the
                                        // recentService when the
                                        // editor's own scan didn't
                                        // turn one up. noteKey shape
                                        // is "<Service>" or
                                        // "<Service>::<Sub>", so the
                                        // first segment is the
                                        // service name.
                                        const svc = recentService || String(noteKey).split('::')[0];
                                        const tokenComp = `@![${name}]`;
                                        const tokenSvc = svc ? ` @[${svc}]` : '';
                                        const cur = String(fields.competitorsNotes || '').trim();
                                        const candidate = `${tokenComp}${tokenSvc}`;
                                        if (cur.includes(candidate)) return;
                                        const nxt = cur ? `${cur}\n${candidate}` : candidate;
                                        set('competitorsNotes', nxt);
                                      }}
                                      placeholder="Add a note. @ for services or competitors."
                                      style={{ minHeight: '40px', fontSize: '0.7rem', padding: '0.2rem 0.3rem' }}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {servicesEditMode && (
                    <div
                      onClick={() => {
                        const name = prompt('New box name:');
                        if (!name?.trim()) return;
                        if (categories.some(c => c.name === name.trim())) { alert('A box with that name already exists.'); return; }
                        saveCategories([...categories, { name: name.trim(), items: [] }]);
                      }}
                      style={{ breakInside: 'avoid', border: '2px dashed var(--color-border)', borderRadius: '5px', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.72rem', fontWeight: 600, marginBottom: '0.4rem' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                    >+ Add Box</div>
                  )}
                  </div>
                </div>
                );
              })()}
            </div>
          )}

          {/* Divisions — other tracker companies that roll up under this
              one. Shares settings.divisionsMap with the My Accounts
              Divisions column. Needs a saved record to key the mapping. */}
          {!isNew && prospect?.id && (
            <DivisionsSection
              parentId={prospect.id}
              parentCompany={fields.company}
              prospects={prospects}
              contacts={localContacts}
              settings={settings}
              updateSettings={updateSettings}
              onOpenContact={setEditingContact}
            />
          )}

          {/* Site List — uploaded spreadsheet of this company's physical
              sites/locations. Surfaces on the Email Drafts page as part of
              the combined Site List Overview. */}
          {!isNew && (
            <div
              style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem', position: 'relative', borderRadius: 8, transition: 'background 0.15s, outline 0.15s', outline: siteListDragActive ? '2px dashed var(--color-accent)' : '2px dashed transparent', outlineOffset: siteListDragActive ? '4px' : '0px', background: siteListDragActive ? 'rgba(59, 125, 221, 0.06)' : 'transparent' }}
              onDragOver={e => {
                if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  if (!siteListDragActive) setSiteListDragActive(true);
                }
              }}
              onDragEnter={e => {
                if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
                  e.preventDefault();
                  setSiteListDragActive(true);
                }
              }}
              onDragLeave={e => {
                if (e.currentTarget === e.target) setSiteListDragActive(false);
              }}
              onDrop={e => {
                e.preventDefault();
                setSiteListDragActive(false);
                const file = e.dataTransfer?.files?.[0];
                if (file) openSiteListFile(file);
              }}
            >
              {siteListDragActive && (
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'var(--color-accent)', color: '#fff', padding: '0.5rem 1rem', borderRadius: 6, fontSize: '0.85rem', fontWeight: 600, pointerEvents: 'none', zIndex: 5, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
                  Drop a spreadsheet to set the Site List
                </div>
              )}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setSiteListOpen(o => !o)}
              >
                <label className={styles.label} style={{ margin: 0, cursor: 'pointer' }}>
                  Site List
                </label>
                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', transform: siteListOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>&#9660;</span>
                {currentSiteList && (currentSiteList.rows || []).length > 0 && (
                  <span style={{ fontSize: '0.68rem', color: '#64748B' }}>
                    {currentSiteList.rows.length} {currentSiteList.rows.length === 1 ? 'site' : 'sites'}
                    {/* What the list adds up to, from the columns it
                        actually carries. Each part appears only when the
                        list has that data — a portfolio nobody has sized
                        says nothing rather than "0 ft²". */}
                    {siteListFacts.sqft != null && (
                      <span
                        title={siteListFacts.sqftSites === currentSiteList.rows.length
                          ? `${siteListFacts.sqft.toLocaleString()} ft² across all ${siteListFacts.sqftSites} sites`
                          : `${siteListFacts.sqft.toLocaleString()} ft² across the ${siteListFacts.sqftSites} of ${currentSiteList.rows.length} sites that carry a size`}
                      >
                        {' · '}{formatSqft(siteListFacts.sqft)}
                        {siteListFacts.sqftSites < currentSiteList.rows.length && ' (partial)'}
                      </span>
                    )}
                    {siteListFacts.divisions.length > 0 && (
                      <span title={siteListFacts.divisions.join('\n')}>
                        {' · '}{siteListFacts.divisions.length} {siteListFacts.divisions.length === 1 ? 'division' : 'divisions'}
                      </span>
                    )}
                    {siteListFacts.propertyTypes.length > 0 && (
                      <span title={siteListFacts.propertyTypes.join('\n')}>
                        {' · '}{siteListFacts.propertyTypes.length} {siteListFacts.propertyTypes.length === 1 ? 'property type' : 'property types'}
                      </span>
                    )}
                  </span>
                )}
              </div>
              {siteListOpen && (
                <div style={{ marginTop: '0.6rem' }}>
                  <input
                    ref={siteListInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) openSiteListFile(file);
                      e.target.value = '';
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => setSiteListPasteOpen(true)}
                      style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem', borderRadius: 6, border: 'none', background: 'var(--color-accent)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {currentSiteList ? 'Replace via paste' : 'Paste from Excel'}
                    </button>
                    <button
                      type="button"
                      onClick={() => siteListInputRef.current?.click()}
                      style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {currentSiteList ? 'Replace via file' : 'Upload file'}
                    </button>
                    {currentSiteList && (
                      <>
                        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
                          {currentSiteList.fileName}
                          {currentSiteList.uploadedAt ? ` · ${new Date(currentSiteList.uploadedAt).toLocaleDateString()}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={removeSiteList}
                          style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem', borderRadius: 6, border: '1px solid #FCA5A5', color: '#B91C1C', background: '#FEF2F2', cursor: 'pointer', fontWeight: 600 }}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                  {!currentSiteList && (
                    <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>
                      Copy the site rows in Excel and click “Paste from Excel” to map columns, drag a spreadsheet here, or use “Upload file”.
                    </p>
                  )}
                  {currentSiteList && (currentSiteList.rows || []).length > 0 && (
                    <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 6 }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: '0.72rem', width: '100%' }}>
                        <thead>
                          <tr>
                            {(currentSiteList.headers || []).map(h => (
                              <th key={h} style={{ position: 'sticky', top: 0, background: '#F8FAFC', textAlign: 'left', padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--color-border-light)', whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {currentSiteList.rows.slice(0, 50).map((r, i) => (
                            <tr key={i}>
                              {(currentSiteList.headers || []).map(h => (
                                <td key={h} style={{ padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--color-border-light)', whiteSpace: 'nowrap' }}>{String(r[h] ?? '')}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {currentSiteList.rows.length > 50 && (
                        <div style={{ padding: '0.35rem 0.5rem', fontSize: '0.68rem', color: '#94A3B8' }}>
                          Showing first 50 of {currentSiteList.rows.length} rows.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {siteListPasteOpen && (
            <SiteListPasteModal
              companyName={fields.company || ''}
              onClose={() => setSiteListPasteOpen(false)}
              onImport={saveSiteListFromPaste}
            />
          )}

          {/* Portfolio Companies */}
          {!isNew && (
            <div
              style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem', position: 'relative', borderRadius: 8, transition: 'background 0.15s, outline 0.15s', outline: portfolioDragActive ? '2px dashed var(--color-accent)' : '2px dashed transparent', outlineOffset: portfolioDragActive ? '4px' : '0px', background: portfolioDragActive ? 'rgba(59, 125, 221, 0.06)' : 'transparent' }}
              onDragOver={e => {
                if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  if (!portfolioDragActive) setPortfolioDragActive(true);
                }
              }}
              onDragEnter={e => {
                if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
                  e.preventDefault();
                  setPortfolioDragActive(true);
                }
              }}
              onDragLeave={e => {
                // Only clear when leaving the wrapper, not when entering a child
                if (e.currentTarget === e.target) setPortfolioDragActive(false);
              }}
              onDrop={e => {
                e.preventDefault();
                setPortfolioDragActive(false);
                const file = e.dataTransfer?.files?.[0];
                if (!file) return;
                if (!/\.(xlsx|xls)$/i.test(file.name)) {
                  alert('Please drop an Excel file (.xlsx or .xls).');
                  return;
                }
                if (!portfolioOpen) setPortfolioOpen(true);
                openPortfolioMappingForFile(file);
              }}
            >
              {portfolioDragActive && (
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'var(--color-accent)', color: '#fff', padding: '0.5rem 1rem', borderRadius: 6, fontSize: '0.85rem', fontWeight: 600, pointerEvents: 'none', zIndex: 5, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
                  Drop Excel to replace Portfolio Companies
                </div>
              )}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setPortfolioOpen(o => !o)}
              >
                <label className={styles.label} style={{ margin: 0, cursor: 'pointer' }}>
                  Portfolio Companies
                </label>
                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', transform: portfolioOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>&#9660;</span>
                {(() => {
                  const n = (fields.portfolioCompanies || []).length;
                  return n > 0 ? <span style={{ fontSize: '0.68rem', color: '#64748B' }}>{n} {n === 1 ? 'company' : 'companies'}</span> : null;
                })()}
              </div>
              {portfolioOpen && (() => {
                const rows = fields.portfolioCompanies || [];
                const savedMappings = settings.savedPortfolioMappings || {};
                const mappingKey = (name) => String(name || '').toLowerCase().trim();
                // Persist the user's latest RA Client Match / Target Account
                // pick for this company so future uploads that include the
                // same company pre-fill these columns automatically.
                function persistMapping(companyName, patch) {
                  const k = mappingKey(companyName);
                  if (!k) return;
                  const current = settings.savedPortfolioMappings || {};
                  const prior = current[k] || {};
                  const next = { ...prior };
                  if ('raClientMatch' in patch) {
                    if (patch.raClientMatch) next.raClientMatch = patch.raClientMatch;
                    else delete next.raClientMatch;
                  }
                  if ('targetAccount' in patch) {
                    if (patch.targetAccount) next.targetAccount = patch.targetAccount;
                    else delete next.targetAccount;
                  }
                  next.updatedAt = Date.now();
                  const nextMap = { ...current };
                  if (next.raClientMatch || next.targetAccount) nextMap[k] = next;
                  else delete nextMap[k];
                  updateSettings({ savedPortfolioMappings: nextMap });
                }
                function updateRow(idx, patch) {
                  const next = rows.map((r, i) => i === idx ? { ...r, ...patch } : r);
                  set('portfolioCompanies', next);
                  if ('raClientMatch' in patch || 'targetAccount' in patch) {
                    persistMapping(rows[idx]?.companyName, patch);
                  }
                }
                function deleteRow(idx) {
                  set('portfolioCompanies', rows.filter((_, i) => i !== idx));
                }
                function addRow() {
                  set('portfolioCompanies', [...rows, { companyName: '', status: '', sector: '', subsector: '', subsectorScore: '', strategy: '', hqCity: '', hqCountry: '', energyGwh: '', estElectricity: '', estNaturalGas: '', siteCount: '', pcDescription: '', acquisitionYear: '', notes: '' }]);
                }
                function parsePaste() {
                  const text = pastePortfolio.trim();
                  if (!text) return;
                  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
                  const parsed = [];
                  for (const line of lines) {
                    const parts = line.split('\t').length > 1 ? line.split('\t') : line.split(/\s{2,}|,/);
                    // Skip header row
                    if (parts[0] && /^(#|number|no\.?)$/i.test(parts[0].trim())) continue;
                    // If first col is a number, shift
                    const startIdx = /^\d+$/.test((parts[0] || '').trim()) ? 1 : 0;
                    const [companyName = '', industry = '', hqCity = '', hqCountry = '', energyGwh = '', siteCount = ''] = parts.slice(startIdx).map(p => p.trim());
                    if (companyName) parsed.push({ companyName, industry, hqCity, hqCountry, energyGwh, siteCount });
                  }
                  if (parsed.length > 0) {
                    set('portfolioCompanies', [...rows, ...parsed]);
                    setPastePortfolio('');
                  }
                }
                async function researchWithClaude() {
                  if (researchingPortfolio || !fields.company) return;
                  const replace = rows.length > 0
                    ? confirm(`This will research "${fields.company}" and ADD new companies to the existing ${rows.length}. Click OK to add, Cancel to abort. (To replace all, clear the table first.)`)
                    : true;
                  if (!replace) return;
                  setResearchingPortfolio(true);
                  setPortfolioResearchError(null);
                  try {
                    const res = await apiFetch('/api/research-portfolio', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ company: fields.company }),
                    });
                    const json = await res.json();
                    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
                    if (!json.companies || json.companies.length === 0) throw new Error('No companies returned');
                    set('portfolioCompanies', [...rows, ...json.companies]);
                  } catch (err) {
                    setPortfolioResearchError(err.message || 'Research failed');
                  }
                  setResearchingPortfolio(false);
                }
                async function downloadTemplate() {
                  const XLSX = await import('xlsx');
                  const templateRows = [
                    {
                      'Company Name': 'Example Company',
                      'Status': 'Inside Sales',
                      'HQ City': 'Austin, TX',
                      'HQ Country': 'USA',
                      'Est. Energy (GWh/yr)': 25,
                      'Est. Electricity': 18,
                      'Est. Natural Gas': 7,
                      'Site Count': 12,
                      'Sector': 'Tech / Software & Office Occupiers',
                      'Subsector': 'Enterprise SaaS',
                      'Subsector Score': 3.2,
                      'Strategy': 'Buyout',
                      'PC Description': 'Short, 1-2 sentence description of what the company does.',
                      'Acquisition Year': 2021,
                      'Notes': '',
                      'RA Client Match': '',
                      'Client Manager': '',
                      'Target Account': '',
                      'Tier': '',
                      'Other CDM': '',
                    },
                  ];
                  const ws = XLSX.utils.json_to_sheet(templateRows, {
                    header: ['Company Name', 'Status', 'HQ City', 'HQ Country', 'Est. Energy (GWh/yr)', 'Est. Electricity', 'Est. Natural Gas', 'Site Count', 'Sector', 'Subsector', 'Subsector Score', 'Strategy', 'Acquisition Year', 'PC Description', 'Notes', 'RA Client Match', 'Client Manager', 'Target Account', 'Tier', 'Other CDM'],
                  });
                  ws['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 28 }, { wch: 22 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 48 }, { wch: 36 }, { wch: 26 }, { wch: 22 }, { wch: 26 }, { wch: 10 }, { wch: 22 }];
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'Portfolio Companies');
                  const safeName = (fields.company || 'company').replace(/[^a-z0-9]+/gi, '_');
                  XLSX.writeFile(wb, `${safeName}_portfolio_template.xlsx`);
                }
                async function downloadCurrent() {
                  await downloadPortfolioCompaniesWorkbook({
                    company: fields.company,
                    rows,
                    topFive: fields.portfolioTopFive,
                    overview: fields.portfolioOverview,
                    listFlags: portfolioListFlags,
                    cmForRaClient,
                    tierForTarget,
                    repForTarget,
                    statusForRow: (r) => resolvePortfolioStatus(r, prospectStatusByName).status,
                  });
                }
                async function handleUpload(e) {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) await openPortfolioMappingForFile(file);
                }
                const totalEnergy = rows.reduce((sum, r) => sum + (Number(r.energyGwh) || 0), 0);
                // Estimated counts ("12 (E)") are real site counts: they add
                // to the total on screen and set the ranking maximum just
                // like a confirmed number does.
                const totalSites = rows.reduce((sum, r) => sum + siteCountNumber(r.siteCount), 0);
                const maxEnergyForRank = rows.reduce((m, r) => Math.max(m, Number(r.energyGwh) || 0), 0);
                const maxSitesForRank = rows.reduce((m, r) => Math.max(m, siteCountNumber(r.siteCount)), 0);
                const yearRangeForRank = (() => {
                  const years = rows.map(r => Number(r.acquisitionYear)).filter(y => y > 0);
                  if (years.length === 0) return null;
                  return { min: Math.min(...years), max: Math.max(...years) };
                })();
                const rowScores = rows.map(r => computePortfolioFitScore(r, maxEnergyForRank, maxSitesForRank, yearRangeForRank));
                // Null scores (explicit N/A) sort to the bottom regardless of direction.
                const scoreForSort = s => s == null ? -Infinity : s;
                const displayOrder = portfolioSortByRank
                  ? rows.map((_, i) => i).sort((a, b) => scoreForSort(rowScores[b]) - scoreForSort(rowScores[a]))
                  : rows.map((_, i) => i);

                // Target Accounts — full list of names from the uploaded sheet (same source as MyAccountsView)
                const targetAccountNames = (() => {
                  const names = new Set();
                  const sheets = targetAccountsData?.sheets;
                  const sheetNames = targetAccountsData?.sheetNames;
                  if (!sheets || !sheetNames) return [];
                  const companyKeywords = ['account name', 'account', 'company name', 'company', 'client name', 'client'];
                  for (const sn of sheetNames) {
                    const sheet = sheets[sn];
                    if (!sheet?.records?.length) continue;
                    const headers = sheet.headers || Object.keys(sheet.records[0]).filter(k => k !== '_id');
                    let companyCol = null;
                    for (const kw of companyKeywords) {
                      for (const h of headers) {
                        if ((h || '').toLowerCase().trim() === kw) { companyCol = h; break; }
                      }
                      if (companyCol) break;
                    }
                    if (!companyCol) {
                      for (const kw of companyKeywords) {
                        for (const h of headers) {
                          if ((h || '').toLowerCase().includes(kw)) { companyCol = h; break; }
                        }
                        if (companyCol) break;
                      }
                    }
                    if (!companyCol) continue;
                    for (const rec of sheet.records) {
                      const v = (rec[companyCol] || '').toString().trim();
                      // Skip names the user has blocked on the Target
                      // Accounts page — keeps suggestions consistent
                      // with the Lists subtabs' behavior.
                      if (v && !blockedTargetAccounts.has(v.toLowerCase())) names.add(v);
                    }
                  }
                  return [...names].sort((a, b) => a.localeCompare(b));
                })();

                function findTargetSuggestions(companyName) {
                  const lower = (companyName || '').toLowerCase().trim();
                  if (!lower) return targetAccountNames.slice(0, 8);
                  const scored = [];
                  for (const name of targetAccountNames) {
                    const n = name.toLowerCase();
                    if (n === lower) { scored.push({ name, score: 100 }); continue; }
                    if (n.includes(lower) || lower.includes(n)) { scored.push({ name, score: 80 }); continue; }
                    const firstLower = lower.split(/[^a-z0-9]+/)[0];
                    const firstN = n.split(/[^a-z0-9]+/)[0];
                    if (firstLower && firstLower.length >= 4 && firstLower === firstN) {
                      scored.push({ name, score: 60 });
                    }
                  }
                  scored.sort((a, b) => b.score - a.score);
                  return scored.slice(0, 8).map(s => s.name);
                }

                // Portfolio-company suggestion dismissals — stored per company name, per suggestion type, synced via userSettings.
                const dismissedGuesses = settings.dismissedPortfolioGuesses || { ra: {}, target: {} };
                function dismissKey(name) { return (name || '').toLowerCase().trim(); }
                function isRaDismissed(company) { const k = dismissKey(company); return !!k && !!(dismissedGuesses.ra || {})[k]; }
                function isTargetDismissed(company) { const k = dismissKey(company); return !!k && !!(dismissedGuesses.target || {})[k]; }
                function setDismiss(type, company, value) {
                  const k = dismissKey(company);
                  if (!k) return;
                  const current = settings.dismissedPortfolioGuesses || { ra: {}, target: {} };
                  const next = {
                    ra: { ...(current.ra || {}) },
                    target: { ...(current.target || {}) },
                  };
                  if (value) next[type][k] = true;
                  else delete next[type][k];
                  updateSettings({ dismissedPortfolioGuesses: next });
                }

                // RA Client matching helpers — read the effective list (user override or bundled default)
                const raClientsData = loadEffectiveRaClients().data;
                // Map lowercase name -> CM, for auto-filling Client Manager when an RA Client Match is set.
                const raNameToCm = (() => {
                  const m = new Map();
                  for (const ra of raClientsData) {
                    const name = raClientName(ra);
                    if (!name) continue;
                    const cm = raClientCm(ra);
                    if (cm && !m.has(name.toLowerCase())) m.set(name.toLowerCase(), cm);
                  }
                  return m;
                })();
                function cmForRaClient(name) { return raNameToCm.get((name || '').toLowerCase()) || ''; }
                // Map lowercase internal client/old-client company names -> status label.
                // Lets us show Client / Old Client suggestions in the RA Client dropdown
                // (and tag them in the UI) alongside the formal RA clients list.
                const internalClientStatusByLower = (() => {
                  const map = new Map();
                  for (const p of prospects) {
                    const name = (p.company || '').trim();
                    if (!name) continue;
                    if (p.status === 'Client' || p.status === 'Old Client') {
                      const key = name.toLowerCase();
                      if (!map.has(key)) map.set(key, { name, status: p.status });
                    }
                  }
                  return map;
                })();
                const allRaClientNames = (() => {
                  const seen = new Set();
                  const names = [];
                  for (const ra of raClientsData) {
                    const name = raClientName(ra);
                    if (!name || seen.has(name.toLowerCase())) continue;
                    seen.add(name.toLowerCase());
                    names.push(name);
                  }
                  for (const { name } of internalClientStatusByLower.values()) {
                    if (!seen.has(name.toLowerCase())) {
                      seen.add(name.toLowerCase());
                      names.push(name);
                    }
                  }
                  return names.sort((a, b) => a.localeCompare(b));
                })();
                function filterNames(list, query, limit = 50) {
                  const q = (query || '').toLowerCase().trim();
                  if (!q) return [];
                  const starts = [];
                  const includes = [];
                  for (const name of list) {
                    const lower = name.toLowerCase();
                    if (lower.startsWith(q)) starts.push(name);
                    else if (lower.includes(q)) includes.push(name);
                    if (starts.length + includes.length >= limit + 20) break;
                  }
                  return [...starts, ...includes].slice(0, limit);
                }
                function findRaSuggestions(companyName) {
                  const lower = (companyName || '').toLowerCase().trim();
                  if (!lower) return [];
                  const scored = [];
                  const seenLower = new Set();
                  function consider(display, baseScore) {
                    const key = display.toLowerCase();
                    if (seenLower.has(key)) return;
                    seenLower.add(key);
                    scored.push({ name: display, score: baseScore });
                  }
                  const pool = [
                    ...raClientsData.map(ra => raClientName(ra)).filter(Boolean),
                    ...Array.from(internalClientStatusByLower.values()).map(v => v.name),
                  ];
                  for (const display of pool) {
                    const name = display.toLowerCase();
                    if (name === lower) { consider(display, 100); continue; }
                    if (name.includes(lower) || lower.includes(name)) { consider(display, 80); continue; }
                    const firstLower = lower.split(/[^a-z0-9]+/)[0];
                    const firstName = name.split(/[^a-z0-9]+/)[0];
                    if (firstLower && firstLower.length >= 4 && firstLower === firstName) {
                      consider(display, 60);
                    }
                  }
                  scored.sort((a, b) => b.score - a.score);
                  return scored.slice(0, 6).map(s => s.name);
                }
                function clientStatusBadge(name) {
                  const entry = internalClientStatusByLower.get((name || '').toLowerCase());
                  return entry ? entry.status : null;
                }

                function startResize(colKey, e) {
                  e.preventDefault();
                  const startX = e.clientX;
                  const startW = portfolioColWidths[colKey] || 100;
                  function onMove(ev) {
                    const delta = ev.clientX - startX;
                    setPortfolioColWidths(prev => ({ ...prev, [colKey]: Math.max(40, startW + delta) }));
                  }
                  function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                  }
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }

                const resizeHandleStyle = { position: 'absolute', right: 0, top: 0, bottom: 0, width: '5px', cursor: 'col-resize', userSelect: 'none' };
                const thBase = { padding: '0.3rem 0.4rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.62rem', textTransform: 'uppercase', borderBottom: '1px solid var(--color-border)', position: 'relative', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', overflow: 'hidden', lineHeight: 1.25, verticalAlign: 'bottom' };
                return (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                      <textarea
                        value={pastePortfolio}
                        onChange={e => setPastePortfolio(e.target.value)}
                        placeholder="Paste table here (tab or comma separated)..."
                        rows={2}
                        style={{ flex: 1, fontSize: '0.7rem', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '5px', fontFamily: 'inherit', resize: 'vertical', minHeight: '36px', lineHeight: 1.3 }}
                      />
                      <button
                        onClick={parsePaste}
                        disabled={!pastePortfolio.trim()}
                        style={{ padding: '0.3rem 0.7rem', border: 'none', borderRadius: '5px', background: pastePortfolio.trim() ? 'var(--color-accent)' : '#CBD5E1', color: '#fff', fontSize: '0.7rem', fontWeight: 600, cursor: pastePortfolio.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                      >Parse Paste</button>
                      <button
                        onClick={addRow}
                        style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: '5px', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-accent)' }}
                      >+ Add Row</button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                      <button
                        onClick={researchWithClaude}
                        disabled={researchingPortfolio}
                        style={{ padding: '0.3rem 0.7rem', border: 'none', borderRadius: '5px', background: researchingPortfolio ? '#94A3B8' : '#7C3AED', color: '#fff', fontSize: '0.7rem', fontWeight: 600, cursor: researchingPortfolio ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                      >{researchingPortfolio ? 'Researching... (up to 60s)' : '✨ Research with Claude'}</button>
                      <button
                        onClick={downloadTemplate}
                        style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: '5px', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' }}
                      >↓ Download Excel Template</button>
                      <button
                        onClick={downloadCurrent}
                        disabled={rows.length === 0}
                        title={rows.length === 0 ? 'No data to download' : `Download ${rows.length} row${rows.length === 1 ? '' : 's'}`}
                        style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: '5px', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: rows.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', color: rows.length === 0 ? 'var(--color-text-muted)' : 'var(--color-accent)', opacity: rows.length === 0 ? 0.6 : 1 }}
                      >↓ Download Current Data</button>
                      <button
                        onClick={() => {
                          const sf = portfolioSourceFile;
                          if (!sf?.blob) return;
                          const url = URL.createObjectURL(sf.blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = sf.name || 'portfolio-source-file';
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        }}
                        disabled={!portfolioSourceFile?.blob}
                        title={portfolioSourceFile?.blob
                          ? `Download the raw ${portfolioSourceFile.name} that was uploaded (unmodified, not the polished export)`
                          : 'No source file uploaded yet: use ↑ Upload Excel to save one'}
                        style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: '5px', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: portfolioSourceFile?.blob ? 'pointer' : 'not-allowed', fontFamily: 'inherit', color: portfolioSourceFile?.blob ? 'var(--color-accent)' : 'var(--color-text-muted)', opacity: portfolioSourceFile?.blob ? 1 : 0.6 }}
                      >↓ Download Source File</button>
                      <label style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: '5px', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' }}>
                        ↑ Upload Excel
                        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} style={{ display: 'none' }} />
                      </label>
                      {(() => {
                        // Show the saved source-file attachment for this company.
                        // Loaded async from IndexedDB into portfolioSourceFile state.
                        const sourceFile = portfolioSourceFile;
                        if (!sourceFile) return null;
                        const sizeKb = sourceFile.size ? Math.round(sourceFile.size / 1024) : null;
                        const uploadedDate = sourceFile.uploadedAt ? new Date(sourceFile.uploadedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
                        return (
                          <div
                            title={`Source file uploaded ${uploadedDate}${sizeKb ? ` · ${sizeKb} KB` : ''}`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 999, background: '#F0FDF4', fontSize: '0.7rem', color: '#166534', fontWeight: 600 }}
                          >
                            <span style={{ fontSize: '0.78rem' }}>📎</span>
                            <button
                              type="button"
                              onClick={() => {
                                if (!sourceFile.blob) return;
                                const url = URL.createObjectURL(sourceFile.blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = sourceFile.name;
                                document.body.appendChild(a);
                                a.click();
                                a.remove();
                                setTimeout(() => URL.revokeObjectURL(url), 1000);
                              }}
                              style={{ color: '#166534', textDecoration: 'underline', fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}
                            >{sourceFile.name}</button>
                            {uploadedDate && <span style={{ color: '#64748B', fontWeight: 400 }}>· {uploadedDate}</span>}
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Remove the saved source file "${sourceFile.name}"? The current Portfolio Companies data is not affected.`)) {
                                  clearPortfolioSourceFile(fields.company);
                                }
                              }}
                              title="Remove the saved source file (does not delete the table)"
                              style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.85rem', padding: '0 2px', lineHeight: 1 }}
                              onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                              onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                            >×</button>
                          </div>
                        );
                      })()}
                      {portfolioResearchError && (
                        <span style={{ fontSize: '0.68rem', color: '#DC2626', fontWeight: 600 }}>{portfolioResearchError}</span>
                      )}
                    </div>
                    {rows.length > 0 && (
                      <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginBottom: 4, position: 'relative' }} data-portfolio-cols-menu>
                        <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                          {(() => {
                            const total = PORTFOLIO_COL_DEFS.length;
                            const shown = PORTFOLIO_COL_DEFS.filter(c => portfolioColsVisible[c.key] !== false).length;
                            return shown === total ? '' : `${shown}/${total} columns shown · export keeps all`;
                          })()}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPortfolioColsMenuOpen(o => !o)}
                          style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 5, background: '#fff', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}
                          title="Show or hide columns on this table. The Excel export always includes every column."
                        >
                          Columns ▾
                        </button>
                        {portfolioColsMenuOpen && (
                          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 2, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', padding: '0.35rem', maxHeight: 360, overflowY: 'auto', zIndex: 30, minWidth: 200 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '0 0.25rem 0.35rem', borderBottom: '1px solid var(--color-border-light)', marginBottom: '0.25rem' }}>
                              <button
                                type="button"
                                onClick={() => setPortfolioColsVisible(Object.fromEntries(PORTFOLIO_COL_DEFS.map(c => [c.key, true])))}
                                style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: '0.65rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                              >Show all</button>
                              <button
                                type="button"
                                onClick={() => setPortfolioColsVisible(prev => ({ ...prev, ...Object.fromEntries(PORTFOLIO_COL_DEFS.filter(c => c.key !== 'company').map(c => [c.key, false])) }))}
                                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '0.65rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                                title="Hide every column except Company"
                              >Hide all</button>
                            </div>
                            {PORTFOLIO_COL_DEFS.map(({ key, label }) => {
                              const checked = portfolioColsVisible[key] !== false;
                              return (
                                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', fontSize: '0.7rem', color: 'var(--color-text)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={e => setPortfolioColsVisible(prev => ({ ...prev, [key]: e.target.checked }))}
                                    style={{ accentColor: 'var(--color-accent)' }}
                                  />
                                  {label}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div style={{ border: '1px solid var(--color-border)', borderRadius: '6px', overflow: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse', fontSize: '0.7rem', tableLayout: 'fixed', width: 'auto' }}>
                          <colgroup>
                            <col style={{ width: portfolioColWidths.rank + 'px',             visibility: colVis('rank') }} />
                            <col style={{ width: portfolioColWidths.company + 'px',          visibility: colVis('company') }} />
                            <col style={{ width: portfolioColWidths.status + 'px',           visibility: colVis('status') }} />
                            <col style={{ width: portfolioColWidths.hqCity + 'px',           visibility: colVis('hqCity') }} />
                            <col style={{ width: portfolioColWidths.hqCountry + 'px',        visibility: colVis('hqCountry') }} />
                            <col style={{ width: portfolioColWidths.energy + 'px',           visibility: colVis('energy') }} />
                            <col style={{ width: portfolioColWidths.estElectricity + 'px',   visibility: colVis('estElectricity') }} />
                            <col style={{ width: portfolioColWidths.estNaturalGas + 'px',    visibility: colVis('estNaturalGas') }} />
                            <col style={{ width: portfolioColWidths.siteCount + 'px',        visibility: colVis('siteCount') }} />
                            <col style={{ width: portfolioColWidths.sector + 'px',           visibility: colVis('sector') }} />
                            <col style={{ width: portfolioColWidths.subsector + 'px',        visibility: colVis('subsector') }} />
                            <col style={{ width: portfolioColWidths.subsectorScore + 'px',   visibility: colVis('subsectorScore') }} />
                            <col style={{ width: portfolioColWidths.strategy + 'px',         visibility: colVis('strategy') }} />
                            <col style={{ width: portfolioColWidths.acquisitionYear + 'px',  visibility: colVis('acquisitionYear') }} />
                            <col style={{ width: portfolioColWidths.pcDescription + 'px',    visibility: colVis('pcDescription') }} />
                            <col style={{ width: portfolioColWidths.notes + 'px',            visibility: colVis('notes') }} />
                            <col style={{ width: portfolioColWidths.raClient + 'px',         visibility: colVis('raClient') }} />
                            <col style={{ width: portfolioColWidths.clientManager + 'px',    visibility: colVis('clientManager') }} />
                            <col style={{ width: portfolioColWidths.targetAccount + 'px',    visibility: colVis('targetAccount') }} />
                            <col style={{ width: portfolioColWidths.tier + 'px',             visibility: colVis('tier') }} />
                            <col style={{ width: portfolioColWidths.salesRep + 'px',         visibility: colVis('salesRep') }} />
                            <col style={{ width: portfolioColWidths.listFlags + 'px',        visibility: colVis('listFlags') }} />
                            <col style={{ width: '28px' }} />
                          </colgroup>
                          <thead>
                            <tr style={{ background: '#F8FAFC' }}>
                              <th
                                style={{ ...thBase, cursor: 'pointer', userSelect: 'none' }}
                                onClick={() => setPortfolioSortByRank(v => !v)}
                                title={portfolioSortByRank ? 'Showing best fit first: click to restore original order' : 'Click to sort best fit first'}
                              >
                                Opportunity Score{portfolioSortByRank ? ' ▼' : ''}<span style={resizeHandleStyle} onMouseDown={e => startResize('rank', e)} />
                              </th>
                              <th style={thBase}>Company<span style={resizeHandleStyle} onMouseDown={e => startResize('company', e)} /></th>
                              <th style={thBase} title="Where this portfolio company stands. Blank rows inherit the status of the matching company in the tracker: pick one here to set the row's own.">Status<span style={resizeHandleStyle} onMouseDown={e => startResize('status', e)} /></th>
                              <th style={thBase}>HQ City<span style={resizeHandleStyle} onMouseDown={e => startResize('hqCity', e)} /></th>
                              <th style={thBase}>HQ Country<span style={resizeHandleStyle} onMouseDown={e => startResize('hqCountry', e)} /></th>
                              <th style={thBase} title="Est. Energy (GWh/yr)">Energy<span style={resizeHandleStyle} onMouseDown={e => startResize('energy', e)} /></th>
                              <th style={thBase} title="Estimated annual electricity consumption">Est. Electricity<span style={resizeHandleStyle} onMouseDown={e => startResize('estElectricity', e)} /></th>
                              <th style={thBase} title="Estimated annual natural gas consumption">Est. Natural Gas<span style={resizeHandleStyle} onMouseDown={e => startResize('estNaturalGas', e)} /></th>
                              <th style={thBase} title="Est. Site Count">Sites<span style={resizeHandleStyle} onMouseDown={e => startResize('siteCount', e)} /></th>
                              <th style={thBase}>Sector<span style={resizeHandleStyle} onMouseDown={e => startResize('sector', e)} /></th>
                              <th style={thBase}>Subsector<span style={resizeHandleStyle} onMouseDown={e => startResize('subsector', e)} /></th>
                              <th style={thBase}>Score<span style={resizeHandleStyle} onMouseDown={e => startResize('subsectorScore', e)} /></th>
                              <th style={thBase} title="PE investment strategy for this portfolio company">Strategy<span style={resizeHandleStyle} onMouseDown={e => startResize('strategy', e)} /></th>
                              <th style={{ ...thBase }}>Acquisition Year<span style={resizeHandleStyle} onMouseDown={e => startResize('acquisitionYear', e)} /></th>
                              <th style={thBase}>PC Description<span style={resizeHandleStyle} onMouseDown={e => startResize('pcDescription', e)} /></th>
                              <th style={thBase}>Notes<span style={resizeHandleStyle} onMouseDown={e => startResize('notes', e)} /></th>
                              <th style={thBase}>RA Client Match<span style={resizeHandleStyle} onMouseDown={e => startResize('raClient', e)} /></th>
                              <th style={thBase}>Client Manager<span style={resizeHandleStyle} onMouseDown={e => startResize('clientManager', e)} /></th>
                              <th style={thBase}>Target Account<span style={resizeHandleStyle} onMouseDown={e => startResize('targetAccount', e)} /></th>
                              <th style={thBase}>Tier<span style={resizeHandleStyle} onMouseDown={e => startResize('tier', e)} /></th>
                              <th style={thBase}>Other CDM<span style={resizeHandleStyle} onMouseDown={e => startResize('salesRep', e)} /></th>
                              <th style={thBase} title="External reporting / disclosure lists this company has been mapped onto from the Lists tab">External Reporting<span style={resizeHandleStyle} onMouseDown={e => startResize('listFlags', e)} /></th>
                              <th style={{ padding: '0.3rem 0.3rem', borderBottom: '1px solid var(--color-border)' }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayOrder.map((i, displayI) => {
                              const r = rows[i];
                              const rawSuggestions = findRaSuggestions(r.companyName);
                              const raDismissed = isRaDismissed(r.companyName);
                              const suggestions = raDismissed ? [] : rawSuggestions;
                              const isMatched = !!r.raClientMatch;
                              const pickerOpen = raClientPickerOpen === i;
                              // Reused-mapping detection — show a distinct
                              // treatment when the RA/Target value matches
                              // what the user previously saved for that
                              // company name.
                              const savedForRow = savedMappings[mappingKey(r.companyName)];
                              const raFromSaved = !!(isMatched && savedForRow && savedForRow.raClientMatch === r.raClientMatch);
                              const targetFromSaved = !!(r.targetAccount && savedForRow && savedForRow.targetAccount === r.targetAccount);
                              return (
                              <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                {(() => {
                                  const score = rowScores[i];
                                  const tier = industryTier(r.sector || r.industry);
                                  const hasImportedScore = r.opportunityScore != null && String(r.opportunityScore).trim() !== '';
                                  const isNA = score == null;
                                  const origin = isNA
                                    ? 'From uploaded file: value was non-numeric (e.g. N/A) so no score is shown'
                                    : hasImportedScore ? 'From uploaded file' : 'Computed (no Opportunity Score column mapped)';
                                  const colors = isNA
                                    ? { bg: '#F8FAFC', color: '#94A3B8', border: '#E2E8F0' }
                                    : (tier ? TIER_COLORS[tier] : { bg: 'transparent', color: '#94A3B8', border: 'var(--color-border)' });
                                  return (
                                    <td style={{ padding: '0.15rem 0.25rem' }}>
                                      <span
                                        title={`${origin}\nFit ${tier || '-'} · Energy ${r.energyGwh || 0} GWh · Sites ${r.siteCount || 0}`}
                                        style={{ display: 'inline-block', minWidth: '38px', padding: '0.1rem 0.35rem', borderRadius: 10, fontSize: '0.68rem', fontWeight: 700, background: colors.bg, color: colors.color, border: `1px solid ${colors.border}` }}
                                      >
                                        {isNA ? 'N/A' : score}
                                      </span>
                                    </td>
                                  );
                                })()}
                                {(() => {
                                  // The name stays editable, so the link to the
                                  // company's own popup is a button beside it
                                  // rather than the text itself — it only shows
                                  // when the row actually matches a Table View
                                  // record, which is also the signal that there
                                  // is something to open.
                                  const linked = onSelectProspect ? findPortfolioProspect(r, prospectByName) : null;
                                  return (
                                    <td style={{ padding: '0.15rem 0.25rem' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                        <input
                                          value={r.companyName || ''}
                                          onChange={e => updateRow(i, { companyName: e.target.value })}
                                          style={{ flex: 1, minWidth: 0, padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)' }}
                                          onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                          onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                        />
                                        {linked ? (
                                          <button
                                            type="button"
                                            onClick={() => openProspect(linked)}
                                            title={`Open "${linked.company}" — this company is on Table View`}
                                            aria-label={`Open ${linked.company}`}
                                            style={{
                                              flex: '0 0 auto', padding: '0 3px', border: 'none', background: 'transparent',
                                              color: 'var(--color-accent)', fontSize: '0.72rem', fontWeight: 700,
                                              fontFamily: 'inherit', cursor: 'pointer', lineHeight: 1.2,
                                            }}
                                          >↗</button>
                                        ) : null}
                                      </div>
                                    </td>
                                  );
                                })()}
                                {(() => {
                                  const { status, from } = resolvePortfolioStatus(r, prospectStatusByName);
                                  const inherited = !!from;
                                  const color = status ? portfolioStatusColor(status) : '#CBD5E1';
                                  // Keep a status that isn't in the house list (e.g. one
                                  // carried in by an uploaded sheet) selectable, so the
                                  // dropdown can't silently drop the row's own value.
                                  const options = !status || STATUSES.includes(status) ? STATUSES : [...STATUSES, status];
                                  return (
                                    <td style={{ padding: '0.15rem 0.25rem' }}>
                                      <select
                                        value={r.status || ''}
                                        onChange={e => updateRow(i, { status: e.target.value })}
                                        title={inherited
                                          ? `${status} — inherited from the tracker record for "${from}". Pick a status here to give this row its own.`
                                          : (status
                                            ? `Status for "${r.companyName || 'this company'}"`
                                            : 'No status yet. Pick one here, or add this company to the tracker and its status shows up automatically.')}
                                        style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.68rem', fontFamily: 'inherit', background: status ? `${color}1A` : 'transparent', color: status ? color : '#CBD5E1', fontWeight: status ? 700 : 400, fontStyle: inherited ? 'italic' : 'normal', cursor: 'pointer' }}
                                        onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; }}
                                        onBlur={e => { e.target.style.border = '1px solid transparent'; }}
                                      >
                                        <option value="">{inherited ? `${status} (inherited)` : '-'}</option>
                                        {options.map(s => <option key={s} value={s}>{s}</option>)}
                                      </select>
                                    </td>
                                  );
                                })()}
                                {['hqCity', 'hqCountry'].map(field => (
                                  <td key={field} style={{ padding: '0.15rem 0.25rem' }}>
                                    <input
                                      value={r[field] || ''}
                                      onChange={e => updateRow(i, { [field]: e.target.value })}
                                      style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)' }}
                                      onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                      onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                    />
                                  </td>
                                ))}
                                <td style={{ padding: '0.15rem 0.25rem' }}>
                                  <input
                                    type="number"
                                    value={r.energyGwh || ''}
                                    onChange={e => updateRow(i, { energyGwh: e.target.value })}
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                <td style={{ padding: '0.15rem 0.25rem' }}>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={r.estElectricity || ''}
                                    onChange={e => updateRow(i, { estElectricity: e.target.value })}
                                    title="Estimated annual electricity consumption"
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                <td style={{ padding: '0.15rem 0.25rem' }}>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={r.estNaturalGas || ''}
                                    onChange={e => updateRow(i, { estNaturalGas: e.target.value })}
                                    title="Estimated annual natural gas consumption"
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                <td style={{ padding: '0.15rem 0.25rem' }}>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={r.siteCount || ''}
                                    onChange={e => updateRow(i, { siteCount: e.target.value })}
                                    title="Number of sites. Optional (E) or (P) suffix marks estimated/projected values."
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                <td style={{ padding: '0.15rem 0.25rem' }}>
                                  <input
                                    value={r.sector || r.industry || ''}
                                    onChange={e => updateRow(i, { sector: e.target.value })}
                                    title={r.sector || r.industry || ''}
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                {(() => {
                                  // Color the Subsector cell by the effective sector-fit score
                                  // (subsectorScore when both label + score present, then sectorScore,
                                  // then keyword-derived from sector text).
                                  const sub = Number(r.subsectorScore);
                                  const subText = (r.subsector || '').trim();
                                  const sec = Number(r.sectorScore);
                                  let effScore;
                                  if (subText && sub > 0) effScore = sub;
                                  else if (sec > 0) effScore = sec;
                                  else effScore = sectorScoreFor(industrySector(r.sector || r.industry));
                                  const tier = tierForScoreValue(effScore);
                                  const tierColors = tier ? TIER_COLORS[tier] : null;
                                  const cellStyle = tierColors ? { padding: '0.15rem 0.25rem', background: tierColors.bg } : { padding: '0.15rem 0.25rem' };
                                  const inputStyle = tierColors
                                    ? { width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: tierColors.color, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
                                    : { width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
                                  return (
                                    <td style={cellStyle} title={tier ? `Fit ${tier} · score ${effScore}` : (r.subsector || '')}>
                                      <input
                                        value={r.subsector || ''}
                                        onChange={e => updateRow(i, { subsector: e.target.value })}
                                        style={inputStyle}
                                        onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                        onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                      />
                                    </td>
                                  );
                                })()}
                                <td style={{ padding: '0.15rem 0.25rem' }}>
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="10"
                                    value={r.subsectorScore || ''}
                                    onChange={e => updateRow(i, { subsectorScore: e.target.value })}
                                    title="Per-row sector fit score (1-10). Overrides the keyword-derived sector score."
                                    placeholder="-"
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                <td style={{ padding: '0.15rem 0.25rem' }}>
                                  <input
                                    type="text"
                                    value={r.strategy || ''}
                                    onChange={e => updateRow(i, { strategy: e.target.value })}
                                    title="PE investment strategy (e.g. Buyout, Growth Equity, Venture, Credit)"
                                    placeholder="-"
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                <td style={{ padding: '0.15rem 0.25rem' }}>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    value={r.acquisitionYear || ''}
                                    onChange={e => updateRow(i, { acquisitionYear: e.target.value })}
                                    placeholder="YYYY"
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                <td style={{ padding: '0.15rem 0.25rem' }}>
                                  <input
                                    value={r.pcDescription || ''}
                                    onChange={e => updateRow(i, { pcDescription: e.target.value })}
                                    title={r.pcDescription || 'Describe what this company does: hover to read full text'}
                                    placeholder="Describe what this company does…"
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                <td style={{ padding: '0.15rem 0.25rem' }}>
                                  <input
                                    value={r.notes || ''}
                                    onChange={e => updateRow(i, { notes: e.target.value })}
                                    title={r.notes || 'Notes: hover to read full text'}
                                    placeholder="Notes…"
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                <td data-picker="ra-client" style={{ padding: 0, position: 'relative', maxWidth: 0 }}>
                                  <div style={{ overflow: 'hidden', padding: '0.15rem 0.25rem' }}>
                                  <button
                                    onClick={() => setRaClientPickerOpen(pickerOpen ? null : i)}
                                    title={raFromSaved ? 'Auto-filled from your saved mapping for this company' : undefined}
                                    style={{ display: 'block', width: '100%', minWidth: 0, maxWidth: '100%', padding: '0.15rem 0.3rem', border: raFromSaved ? '1px dashed #3B82F6' : '1px solid transparent', borderRadius: '3px', fontSize: '0.68rem', fontFamily: 'inherit', background: raFromSaved ? '#DBEAFE' : (isMatched ? '#DCFCE7' : 'transparent'), color: raFromSaved ? '#1E40AF' : (isMatched ? '#166534' : (suggestions.length > 0 ? '#F59E0B' : '#CBD5E1')), cursor: 'pointer', textAlign: 'left', fontWeight: isMatched ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    onMouseEnter={e => e.currentTarget.style.border = '1px solid var(--color-accent)'}
                                    onMouseLeave={e => e.currentTarget.style.border = raFromSaved ? '1px dashed #3B82F6' : '1px solid transparent'}
                                  >
                                    {isMatched ? `${raFromSaved ? '★' : '✓'} ${r.raClientMatch}` : (suggestions.length > 0 ? `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} ▾` : '(Click to map)')}
                                  </button>
                                  </div>
                                  {pickerOpen && (() => {
                                    const isSearching = !!raClientPickerQuery.trim();
                                    const searched = filterNames(allRaClientNames, raClientPickerQuery, 100);
                                    const fullList = isSearching ? searched : allRaClientNames;
                                    const showSuggestionsSection = !isSearching && suggestions.length > 0;
                                    const suggestionSet = new Set(suggestions);
                                    const browseList = showSuggestionsSection ? fullList.filter(n => !suggestionSet.has(n)) : fullList;
                                    return (
                                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, background: '#fff', border: '1px solid var(--color-border)', borderRadius: '5px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: '260px', maxHeight: '280px', display: 'flex', flexDirection: 'column', marginTop: '2px' }}>
                                      <div style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
                                        <input
                                          autoFocus
                                          value={raClientPickerQuery}
                                          onChange={e => setRaClientPickerQuery(e.target.value)}
                                          placeholder="Search RA clients…"
                                          style={{ width: '100%', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit' }}
                                        />
                                      </div>
                                      <div style={{ overflowY: 'auto', flex: 1 }}>
                                        {r.raClientMatch && (
                                          <button
                                            onClick={() => { updateRow(i, { raClientMatch: '' }); setRaClientPickerOpen(null); }}
                                            style={{ display: 'block', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: 'none', textAlign: 'left', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit', color: '#DC2626', borderBottom: '1px solid #F1F5F9' }}
                                            onMouseEnter={e => e.currentTarget.style.background = '#FEF2F2'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                          >× Clear mapping</button>
                                        )}
                                        {isSearching && fullList.length === 0 && (
                                          <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.68rem', color: '#94A3B8', fontStyle: 'italic' }}>
                                            No RA clients match "{raClientPickerQuery}"
                                          </div>
                                        )}
                                        {showSuggestionsSection && (
                                          <>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.25rem 0.6rem', background: '#F8FAFC' }}>
                                              <span style={{ fontSize: '0.6rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Suggestions for {r.companyName}</span>
                                              <button
                                                type="button"
                                                onClick={() => { setDismiss('ra', r.companyName, true); setRaClientPickerOpen(null); }}
                                                title="Hide these suggestions for this company"
                                                style={{ background: 'none', border: 'none', fontSize: '0.6rem', color: '#94A3B8', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}
                                                onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                                                onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                                              >× Dismiss</button>
                                            </div>
                                            {suggestions.map(s => {
                                              const badge = clientStatusBadge(s);
                                              return (
                                              <button
                                                key={`sug-${s}`}
                                                onClick={() => { updateRow(i, { raClientMatch: s }); setRaClientPickerOpen(null); }}
                                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: r.raClientMatch === s ? '#DCFCE7' : '#FFFBEB', textAlign: 'left', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)', fontWeight: 600 }}
                                                onMouseEnter={e => e.currentTarget.style.background = '#FEF3C7'}
                                                onMouseLeave={e => e.currentTarget.style.background = r.raClientMatch === s ? '#DCFCE7' : '#FFFBEB'}
                                              >
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</span>
                                                {badge && <span style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 999, fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: badge === 'Client' ? '#DCFCE7' : '#E2E8F0', color: badge === 'Client' ? '#166534' : '#475569' }}>{badge}</span>}
                                              </button>
                                              );
                                            })}
                                          </>
                                        )}
                                        {!isSearching && raDismissed && rawSuggestions.length > 0 && (
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.3rem 0.6rem', fontSize: '0.65rem', color: '#64748B', background: '#F8FAFC' }}>
                                            <span>Suggestions dismissed for {r.companyName}</span>
                                            <button
                                              type="button"
                                              onClick={() => setDismiss('ra', r.companyName, false)}
                                              style={{ background: 'none', border: 'none', fontSize: '0.65rem', color: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600 }}
                                            >Undo</button>
                                          </div>
                                        )}
                                        {!isSearching && (showSuggestionsSection || browseList.length > 0) && (
                                          <div style={{ padding: '0.25rem 0.6rem', fontSize: '0.6rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, background: '#F8FAFC' }}>
                                            All RA Clients ({allRaClientNames.length})
                                          </div>
                                        )}
                                        {browseList.map(s => {
                                          const badge = clientStatusBadge(s);
                                          return (
                                          <button
                                            key={s}
                                            onClick={() => { updateRow(i, { raClientMatch: s }); setRaClientPickerOpen(null); }}
                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: r.raClientMatch === s ? '#DCFCE7' : 'none', textAlign: 'left', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' }}
                                            onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                                            onMouseLeave={e => e.currentTarget.style.background = r.raClientMatch === s ? '#DCFCE7' : 'none'}
                                          >
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</span>
                                            {badge && <span style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 999, fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: badge === 'Client' ? '#DCFCE7' : '#E2E8F0', color: badge === 'Client' ? '#166534' : '#475569' }}>{badge}</span>}
                                          </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                    );
                                  })()}
                                </td>
                                {(() => {
                                  const suggestedCm = cmForRaClient(r.raClientMatch);
                                  const userOverride = (r.clientManager || '').trim();
                                  const displayValue = userOverride || suggestedCm || '';
                                  const showingSuggestion = !userOverride && !!suggestedCm;
                                  return (
                                    <td style={{ padding: '0.15rem 0.25rem' }}>
                                      <input
                                        value={displayValue}
                                        onChange={e => {
                                          const v = e.target.value;
                                          // If they typed the same string the suggestion already provides,
                                          // store nothing so the suggestion stays "live" against future
                                          // RA-Client changes. Otherwise save as a manual override.
                                          if (suggestedCm && v.trim() === suggestedCm.trim()) {
                                            updateRow(i, { clientManager: '' });
                                          } else {
                                            updateRow(i, { clientManager: v });
                                          }
                                        }}
                                        placeholder="-"
                                        title={showingSuggestion ? `Suggested from RA Client "${r.raClientMatch}": select and copy as needed, or type to override.` : undefined}
                                        style={{
                                          width: '100%',
                                          padding: '0.15rem 0.3rem',
                                          border: '1px solid transparent',
                                          borderRadius: '3px',
                                          fontSize: '0.7rem',
                                          fontFamily: 'inherit',
                                          background: 'transparent',
                                          color: showingSuggestion ? '#64748B' : 'var(--color-text)',
                                          fontStyle: showingSuggestion ? 'italic' : 'normal',
                                        }}
                                        onFocus={e => {
                                          e.target.style.border = '1px solid var(--color-accent)';
                                          e.target.style.background = '#fff';
                                          // Auto-select on focus when displaying a suggestion so a single
                                          // keystroke replaces it cleanly while still allowing copy.
                                          if (showingSuggestion) e.target.select();
                                        }}
                                        onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                      />
                                    </td>
                                  );
                                })()}
                                {(() => {
                                  const targetOpen = targetAccountPickerOpen === i;
                                  const rawTargetSuggestions = findTargetSuggestions(r.companyName);
                                  const targetDismissed = isTargetDismissed(r.companyName);
                                  const targetSuggestions = targetDismissed ? [] : rawTargetSuggestions;
                                  const hasTarget = !!r.targetAccount;
                                  return (
                                    <td data-picker="target-account" style={{ padding: 0, position: 'relative', maxWidth: 0 }}>
                                      <div style={{ overflow: 'hidden', padding: '0.15rem 0.25rem' }}>
                                      <button
                                        onClick={() => setTargetAccountPickerOpen(targetOpen ? null : i)}
                                        title={targetFromSaved ? 'Auto-filled from your saved mapping for this company' : undefined}
                                        style={{ display: 'block', width: '100%', minWidth: 0, maxWidth: '100%', padding: '0.15rem 0.3rem', border: targetFromSaved ? '1px dashed #3B82F6' : '1px solid transparent', borderRadius: '3px', fontSize: '0.68rem', fontFamily: 'inherit', background: hasTarget ? '#DBEAFE' : 'transparent', color: hasTarget ? '#1E40AF' : (targetSuggestions.length > 0 ? '#3B7DDD' : '#CBD5E1'), cursor: 'pointer', textAlign: 'left', fontWeight: hasTarget ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                        onMouseEnter={e => e.currentTarget.style.border = '1px solid var(--color-accent)'}
                                        onMouseLeave={e => e.currentTarget.style.border = targetFromSaved ? '1px dashed #3B82F6' : '1px solid transparent'}
                                      >
                                        {hasTarget ? `${targetFromSaved ? '★' : '✓'} ${r.targetAccount}` : (targetAccountNames.length === 0 ? '(No target list loaded)' : (targetSuggestions.length > 0 ? `${targetSuggestions.length} suggestion${targetSuggestions.length === 1 ? '' : 's'} ▾` : '(Click to map)'))}
                                      </button>
                                      </div>
                                      {targetOpen && (() => {
                                        const isSearching = !!targetAccountPickerQuery.trim();
                                        const searched = filterNames(targetAccountNames, targetAccountPickerQuery, 100);
                                        const fullList = isSearching ? searched : targetAccountNames;
                                        const showSuggestionsSection = !isSearching && targetSuggestions.length > 0;
                                        const suggestionSet = new Set(targetSuggestions);
                                        const browseList = showSuggestionsSection ? fullList.filter(n => !suggestionSet.has(n)) : fullList;
                                        return (
                                        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, background: '#fff', border: '1px solid var(--color-border)', borderRadius: '5px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: '280px', maxHeight: '300px', display: 'flex', flexDirection: 'column', marginTop: '2px' }}>
                                          <div style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
                                            <input
                                              autoFocus
                                              value={targetAccountPickerQuery}
                                              onChange={e => setTargetAccountPickerQuery(e.target.value)}
                                              placeholder={targetAccountNames.length === 0 ? 'No target accounts loaded' : 'Search target accounts…'}
                                              disabled={targetAccountNames.length === 0}
                                              style={{ width: '100%', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit' }}
                                            />
                                          </div>
                                          <div style={{ overflowY: 'auto', flex: 1 }}>
                                            {hasTarget && (
                                              <button
                                                onClick={() => { updateRow(i, { targetAccount: '' }); setTargetAccountPickerOpen(null); }}
                                                style={{ display: 'block', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: 'none', textAlign: 'left', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit', color: '#DC2626', borderBottom: '1px solid #F1F5F9' }}
                                                onMouseEnter={e => e.currentTarget.style.background = '#FEF2F2'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                              >× Clear mapping</button>
                                            )}
                                            {targetAccountNames.length === 0 && (
                                              <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.68rem', color: '#94A3B8', fontStyle: 'italic' }}>Upload a Target Accounts file on the My Accounts tab first.</div>
                                            )}
                                            {isSearching && targetAccountNames.length > 0 && fullList.length === 0 && (
                                              <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.68rem', color: '#94A3B8', fontStyle: 'italic' }}>
                                                No target accounts match "{targetAccountPickerQuery}"
                                              </div>
                                            )}
                                            {showSuggestionsSection && (
                                              <>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.25rem 0.6rem', background: '#F8FAFC' }}>
                                                  <span style={{ fontSize: '0.6rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Suggestions for {r.companyName}</span>
                                                  <button
                                                    type="button"
                                                    onClick={() => { setDismiss('target', r.companyName, true); setTargetAccountPickerOpen(null); }}
                                                    title="Hide these suggestions for this company"
                                                    style={{ background: 'none', border: 'none', fontSize: '0.6rem', color: '#94A3B8', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}
                                                    onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                                                    onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                                                  >× Dismiss</button>
                                                </div>
                                                {targetSuggestions.map(s => (
                                                  <button
                                                    key={`sug-${s}`}
                                                    onClick={() => { updateRow(i, { targetAccount: s }); setTargetAccountPickerOpen(null); }}
                                                    style={{ display: 'block', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: r.targetAccount === s ? '#DBEAFE' : '#FFFBEB', textAlign: 'left', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)', fontWeight: 600 }}
                                                    onMouseEnter={e => e.currentTarget.style.background = '#FEF3C7'}
                                                    onMouseLeave={e => e.currentTarget.style.background = r.targetAccount === s ? '#DBEAFE' : '#FFFBEB'}
                                                  >{s}</button>
                                                ))}
                                              </>
                                            )}
                                            {!isSearching && targetDismissed && rawTargetSuggestions.length > 0 && (
                                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.3rem 0.6rem', fontSize: '0.65rem', color: '#64748B', background: '#F8FAFC' }}>
                                                <span>Suggestions dismissed for {r.companyName}</span>
                                                <button
                                                  type="button"
                                                  onClick={() => setDismiss('target', r.companyName, false)}
                                                  style={{ background: 'none', border: 'none', fontSize: '0.65rem', color: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600 }}
                                                >Undo</button>
                                              </div>
                                            )}
                                            {!isSearching && targetAccountNames.length > 0 && (
                                              <div style={{ padding: '0.25rem 0.6rem', fontSize: '0.6rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, background: '#F8FAFC' }}>
                                                All Target Accounts ({targetAccountNames.length})
                                              </div>
                                            )}
                                            {browseList.map(s => (
                                              <button
                                                key={s}
                                                onClick={() => { updateRow(i, { targetAccount: s }); setTargetAccountPickerOpen(null); }}
                                                style={{ display: 'block', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: r.targetAccount === s ? '#DBEAFE' : 'none', textAlign: 'left', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' }}
                                                onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                                                onMouseLeave={e => e.currentTarget.style.background = r.targetAccount === s ? '#DBEAFE' : 'none'}
                                              >{s}</button>
                                            ))}
                                          </div>
                                        </div>
                                        );
                                      })()}
                                    </td>
                                  );
                                })()}
                                {(() => {
                                  const tier = tierForTarget(r.targetAccount);
                                  return (
                                    <td style={{ padding: '0.15rem 0.3rem', fontSize: '0.7rem', color: tier ? 'var(--color-text)' : '#CBD5E1', fontStyle: tier ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tier ? `Tier for "${r.targetAccount}" from the Target Accounts sheet` : (r.targetAccount ? 'No tier found on Target Accounts sheet for this account' : 'Map a target account to see its tier')}>
                                      {tier || (r.targetAccount ? '-' : '-')}
                                    </td>
                                  );
                                })()}
                                {(() => {
                                  const rep = repForTarget(r.targetAccount);
                                  return (
                                    <td style={{ padding: '0.15rem 0.3rem', fontSize: '0.7rem', color: rep ? 'var(--color-text)' : '#CBD5E1', fontStyle: rep ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rep ? `From Target Accounts sheet for "${r.targetAccount}"` : (r.targetAccount ? 'No rep found on Target Accounts sheet for this account' : 'Map a target account to see its rep')}>
                                      {rep || (r.targetAccount ? '(no rep found)' : '-')}
                                    </td>
                                  );
                                })()}
                                {(() => {
                                  const flagSet = portfolioListFlags.get((r.companyName || '').toLowerCase().trim());
                                  const flags = flagSet ? [...flagSet] : [];
                                  return (
                                    <td style={{ padding: '0.15rem 0.3rem' }}>
                                      {flags.length === 0
                                        ? <span style={{ color: '#CBD5E1', fontSize: '0.7rem' }}>-</span>
                                        : (
                                          <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                            {flags.map(label => {
                                              const color = LIST_FLAG_BY_LABEL[label]?.color || { bg: '#F1F5F9', text: '#334155' };
                                              return (
                                                <span
                                                  key={label}
                                                  title={`Flagged on the ${label} list`}
                                                  style={{ padding: '1px 6px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: color.bg, color: color.text, whiteSpace: 'nowrap' }}
                                                >{label}</span>
                                              );
                                            })}
                                          </span>
                                        )
                                      }
                                    </td>
                                  );
                                })()}
                                <td style={{ padding: '0.15rem 0.25rem', textAlign: 'center' }}>
                                  <button
                                    onClick={() => deleteRow(i)}
                                    title="Remove"
                                    style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.8rem', cursor: 'pointer', padding: '0 3px', lineHeight: 1, fontFamily: 'inherit' }}
                                    onMouseEnter={e => e.target.style.color = '#EF4444'}
                                    onMouseLeave={e => e.target.style.color = '#CBD5E1'}
                                  >&times;</button>
                                </td>
                              </tr>
                              );
                            })}
                            {(totalEnergy > 0 || totalSites > 0) && (
                              <tr style={{ background: '#F8FAFC', fontWeight: 700 }}>
                                {/* Cell spans track the 23 columns above: Totals covers
                                    Opportunity Score → HQ Country, then each total sits
                                    under the column it sums. */}
                                <td colSpan={5} style={{ padding: '0.3rem 0.4rem', fontSize: '0.65rem', color: '#64748B', textTransform: 'uppercase' }}>Totals</td>
                                <td style={{ padding: '0.3rem 0.4rem' }}>{totalEnergy > 0 ? totalEnergy.toLocaleString() : ''}</td>
                                <td colSpan={2}></td>
                                <td style={{ padding: '0.3rem 0.4rem' }}>{totalSites > 0 ? totalSites.toLocaleString() : ''}</td>
                                <td colSpan={14}></td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      </>
                    )}
                    {rows.length === 0 && (
                      <div style={{ fontSize: '0.75rem', color: '#9CA3AF', fontStyle: 'italic', padding: '0.25rem 0' }}>No portfolio companies yet: paste a table above or add rows manually</div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {!isNew && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <label className={styles.label} style={{ margin: 0 }}>
                  Contacts {companyContacts.length > 0 ? `(${companyContacts.length})` : ''}
                </label>
                <div style={{ display: 'flex', gap: '0.25rem', background: '#F1F5F9', borderRadius: '6px', padding: '2px' }}>
                  <button
                    onClick={() => setContactView('table')}
                    style={{ padding: '0.2rem 0.6rem', border: 'none', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: contactView === 'table' ? '#fff' : 'transparent', color: contactView === 'table' ? '#1E293B' : '#94A3B8', boxShadow: contactView === 'table' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none' }}
                  >Table</button>
                  <button
                    onClick={() => setContactView('orgchart')}
                    style={{ padding: '0.2rem 0.6rem', border: 'none', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: contactView === 'orgchart' ? '#fff' : 'transparent', color: contactView === 'orgchart' ? '#1E293B' : '#94A3B8', boxShadow: contactView === 'orgchart' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none' }}
                  >By Category</button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHiddenContacts(v => !v)}
                  title={showHiddenContacts
                    ? 'Hide contacts tagged "hide" again. Click an uncovered contact to clear the tag from the contact card.'
                    : `Surface ${hiddenContactsCount} hide-tagged contact${hiddenContactsCount === 1 ? '' : 's'} at this company so you can audit them or clear the tag.`}
                  style={{
                    padding: '0.25rem 0.6rem',
                    border: '1px solid ' + (showHiddenContacts ? '#7C3AED' : 'var(--color-border)'),
                    borderRadius: '4px',
                    background: showHiddenContacts ? '#F3E8FF' : '#fff',
                    color: showHiddenContacts ? '#5B21B6' : 'var(--color-text-secondary)',
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {showHiddenContacts ? 'Hide hidden' : 'Show hidden'}
                  <span style={{
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: 999,
                    background: showHiddenContacts ? '#5B21B6' : (hiddenContactsCount > 0 ? '#EDE9FE' : '#F1F5F9'),
                    color: showHiddenContacts ? '#fff' : (hiddenContactsCount > 0 ? '#5B21B6' : '#94A3B8'),
                    minWidth: 16,
                    textAlign: 'center',
                  }}>{hiddenContactsCount}</span>
                </button>
                <button
                  onClick={async () => {
                    if (!companyContacts || companyContacts.length === 0) { alert('No contacts to export.'); return; }
                    // Brand palette (matches Portfolio Companies export)
                    const SE_GREEN = 'FF3DCD58';
                    const SE_GREEN_DARK = 'FF009530';
                    const SE_TEXT_DARK = 'FF1E293B';
                    const SE_ZEBRA = 'FFF6F9F4';
                    const SE_BORDER = 'FFD4DDE1';
                    const headers = ['First Name', 'Last Name', 'Name', 'Full Name', 'Title', 'Reports To', 'Team Name', 'Tags', 'Role', 'Email', 'Phone', 'City', 'State', 'Country', 'LinkedIn', 'Notes'];
                    const colWidths = [18, 18, 22, 26, 28, 24, 20, 24, 14, 32, 18, 18, 10, 14, 32, 40];
                    const sorted = [...companyContacts].sort((a, b) => {
                      const aLeft = contactHasTag(a, 'left') ? 1 : 0;
                      const bLeft = contactHasTag(b, 'left') ? 1 : 0;
                      if (aLeft !== bLeft) return aLeft - bLeft;
                      return ((a.lastname || '') + (a.firstname || '')).localeCompare((b.lastname || '') + (b.firstname || ''));
                    });
                    const nicknames = settings.contactNicknames || {};
                    const teamNames = settings.contactTeamNames || {};
                    const contactNotes = settings.contactNotes || {};
                    // Coerce a stored LinkedIn value (full URL, bare
                    // linkedin.com path, or vanity slug) into a clickable
                    // https URL; returns '' when there's nothing to link.
                    const toLinkedInUrl = (raw) => {
                      const v = String(raw || '').trim();
                      if (!v) return '';
                      if (/^https?:\/\//i.test(v)) return v;
                      if (/linkedin\.com/i.test(v)) return `https://${v.replace(/^\/+/, '')}`;
                      return `https://www.linkedin.com/in/${v.replace(/^\/+/, '')}`;
                    };
                    // Resolve each contact's "Reports To" manager ids (stored
                    // in settings.contactReportsTo) to display names, using
                    // the full contact pool since a manager may not be in
                    // this company's roster.
                    const reportsToMap = settings.contactReportsTo || {};
                    const contactById = new Map();
                    for (const c of hubspotContacts) { const id = c.id || c.vid; if (id) contactById.set(String(id), c); }
                    const contactName = (c) => [(c.firstname || '').trim(), (c.lastname || '').trim()].filter(Boolean).join(' ') || (c.email || '');
                    const data = sorted.map(c => {
                      const name = [c.firstname, c.lastname].filter(Boolean).join(' ') || '';
                      const nick = c.id && nicknames[c.id] ? nicknames[c.id] : '';
                      const fullName = nick ? `${name} (${nick})`.trim() : name;
                      const tags = c.dans_tags || c.dan_s_tags || c.dans_tag || '';
                      const role = contactHasTag(c, 'decision maker') ? 'Decision Maker'
                        : contactHasTag(c, 'left') ? 'Left'
                        : contactHasTag(c, 'hide') ? 'Hide' : '';
                      const note = (c.id && contactNotes[c.id]) || c.notes || c.hs_content_membership_notes || '';
                      const linkedin = c.hs_linkedin_url || c.linkedin_url || c.hs_linkedinid || '';
                      const mgrIds = (c.id && Array.isArray(reportsToMap[c.id])) ? reportsToMap[c.id] : [];
                      const reportsTo = mgrIds
                        .map(id => { const m = contactById.get(String(id)); return m ? contactName(m) : ''; })
                        .filter(Boolean)
                        .join(', ');
                      return [
                        c.firstname || '', c.lastname || '',
                        name, fullName, c.jobtitle || '', reportsTo, (c.id && teamNames[c.id]) || '',
                        tags, role, c.email || '', c.phone || '',
                        c.city || '', c.state || '', c.country || '',
                        linkedin, note,
                      ];
                    });
                    try {
                      const { Workbook } = await import('exceljs');
                      const wb = new Workbook();
                      wb.creator = 'Schneider Electric · Prospect Tracker';
                      wb.created = new Date();
                      const ws = wb.addWorksheet('Contacts', {
                        properties: { tabColor: { argb: SE_GREEN } },
                        views: [{ state: 'frozen', ySplit: 1 }],
                      });
                      ws.columns = colWidths.map(w => ({ width: w }));

                      // Header row
                      const headerRow = ws.getRow(1);
                      headers.forEach((h, i) => {
                        const cell = headerRow.getCell(i + 1);
                        cell.value = h;
                        cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
                        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
                        cell.border = {
                          top: { style: 'thin', color: { argb: SE_BORDER } },
                          bottom: { style: 'thin', color: { argb: SE_BORDER } },
                          left: { style: 'thin', color: { argb: SE_BORDER } },
                          right: { style: 'thin', color: { argb: SE_BORDER } },
                        };
                      });
                      headerRow.height = 30;

                      // Data rows + zebra
                      data.forEach((vals, idx) => {
                        const row = ws.getRow(2 + idx);
                        const zebra = idx % 2 === 1;
                        vals.forEach((v, i) => {
                          const cell = row.getCell(i + 1);
                          // Full Name (col 3) links to the contact's LinkedIn
                          // (col 14) when available, rendered as a blue link.
                          const liUrl = i === 3 ? toLinkedInUrl(vals[14]) : '';
                          if (i === 3 && v && liUrl) {
                            cell.value = { text: v, hyperlink: liUrl };
                            cell.font = { name: 'Nunito Sans', size: 10, color: { argb: 'FF0563C1' }, underline: true };
                          } else {
                            cell.value = v === '' || v == null ? null : v;
                            cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
                          }
                          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: i === 15 /* Notes */ };
                          cell.border = {
                            bottom: { style: 'thin', color: { argb: SE_BORDER } },
                            left: { style: 'thin', color: { argb: SE_BORDER } },
                            right: { style: 'thin', color: { argb: SE_BORDER } },
                          };
                          if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_ZEBRA } };
                        });
                        row.height = 18;
                      });

                      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
                      colWidths.forEach((w, idx) => { ws.getColumn(idx + 1).width = w; });

                      sanitizeExcelWorkbook(wb);
                      const buf = await wb.xlsx.writeBuffer();
                      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                      const url = URL.createObjectURL(blob);
                      const safeCompany = (fields.company || 'Company').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${safeCompany} - Contacts.xlsx`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    } catch (err) {
                      alert('Failed to export contacts: ' + (err.message || err));
                    }
                  }}
                  style={{ marginLeft: 'auto', padding: '0.2rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#059669' }}
                >Export Excel</button>
                <button
                  onClick={async () => {
                    try {
                      const { Workbook } = await import('exceljs');
                      const wb = new Workbook();
                      const ws = wb.addWorksheet('Contacts Template');
                      const headers = ['First Name', 'Last Name', 'Job Title', 'Team Name', 'Email', 'Phone', 'City', 'State', 'Country', 'LinkedIn', 'Tags', 'Notes'];
                      const colWidths = [18, 18, 28, 20, 32, 18, 18, 10, 14, 32, 24, 40];
                      ws.columns = colWidths.map(w => ({ width: w }));
                      const headerRow = ws.getRow(1);
                      headers.forEach((h, i) => {
                        const cell = headerRow.getCell(i + 1);
                        cell.value = h;
                        cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF009530' } };
                        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                      });
                      headerRow.height = 24;
                      // One example row for clarity.
                      const example = ws.getRow(2);
                      ['Jane', 'Doe', 'Director of Sustainability', 'ESG', 'jane.doe@example.com', '+1 555 123 4567', 'Boston', 'MA', 'USA', 'https://linkedin.com/in/janedoe', 'ESG; Procurement', 'Met at Q3 summit'].forEach((v, i) => {
                        const cell = example.getCell(i + 1);
                        cell.value = v;
                        cell.font = { name: 'Nunito Sans', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
                      });
                      ws.views = [{ state: 'frozen', ySplit: 1 }];
                      sanitizeExcelWorkbook(wb);
                      const buf = await wb.xlsx.writeBuffer();
                      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'Contacts Template.xlsx';
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    } catch (err) {
                      alert('Failed to generate template: ' + (err.message || err));
                    }
                  }}
                  style={{ marginLeft: '0.4rem', padding: '0.2rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#0369A1' }}
                >Generate Template</button>
                <input
                  ref={contactsImportRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  style={{ display: 'none' }}
                  onChange={async e => {
                    const file = e.target.files && e.target.files[0];
                    e.target.value = '';
                    await processContactsFile(file);
                  }}
                />
                <button
                  onClick={() => contactsImportRef.current?.click()}
                  style={{ marginLeft: '0.4rem', padding: '0.2rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#7C3AED' }}
                >Import Excel</button>
                {isAdmin && (
                  <>
                    {refreshHubspotError && (
                      <span title={refreshHubspotError} style={{ marginLeft: '0.4rem', fontSize: '0.68rem', fontWeight: 600, color: '#DC2626' }}>Refresh failed</span>
                    )}
                    <button
                      type="button"
                      onClick={refreshHubspotContacts}
                      disabled={refreshingHubspot}
                      title="Re-pull every HubSpot contact and overwrite the local cache. This company's roster refreshes in place."
                      style={{ marginLeft: '0.4rem', padding: '0.2rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 600, cursor: refreshingHubspot ? 'default' : 'pointer', fontFamily: 'inherit', background: '#fff', color: '#0891B2', opacity: refreshingHubspot ? 0.6 : 1 }}
                    >{refreshingHubspot ? 'Refreshing…' : 'Refresh HubSpot Contacts'}</button>
                  </>
                )}
                <button
                  onClick={() => { setAddingContact(true); setEditingContact({ company: fields.company, firstname: '', lastname: '', email: '', phone: '', mobilephone: '', jobtitle: '', hs_linkedin_url: '', dans_tags: '' }); }}
                  style={{ marginLeft: '0.4rem', padding: '0.2rem 0.6rem', border: 'none', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: 'var(--color-accent)', color: '#fff' }}
                >+ Add Contact</button>
              </div>

              <div
                onDragEnter={e => { if (e.dataTransfer?.types?.includes?.('Files')) { e.preventDefault(); setContactsDragging(true); } }}
                onDragOver={e => { if (e.dataTransfer?.types?.includes?.('Files')) { e.preventDefault(); setContactsDragging(true); } }}
                onDragLeave={e => {
                  if (e.currentTarget.contains(e.relatedTarget)) return;
                  setContactsDragging(false);
                }}
                onDrop={async e => {
                  e.preventDefault();
                  setContactsDragging(false);
                  const file = e.dataTransfer?.files?.[0];
                  await processContactsFile(file);
                }}
                style={{ position: 'relative', border: contactsDragging ? '2px dashed #7C3AED' : '2px dashed transparent', borderRadius: 6, transition: 'border-color 0.15s' }}
              >
                {contactsDragging && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(124, 58, 237, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 10, borderRadius: 6 }}>
                    <div style={{ padding: '0.75rem 1.25rem', background: '#fff', border: '2px solid #7C3AED', borderRadius: 8, fontWeight: 700, color: '#7C3AED', fontSize: '0.9rem', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                      Drop Excel file to replace contacts
                    </div>
                  </div>
                )}
              {contactView === 'orgchart' ? (
                <OrgChart contacts={companyContacts} onDeleteContact={handleDeleteContact} deletingContact={deletingContact} onEditContact={setEditingContact} reportsTo={settings.contactReportsTo || {}} />
              ) : companyContacts.length > 0 ? (
                <>
                {bulkSelected.size > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', marginBottom: '0.4rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '6px', fontSize: '0.75rem', color: '#1E3A8A' }}>
                    <strong style={{ fontWeight: 700 }}>{bulkSelected.size} selected</strong>
                    <div style={{ flex: 1 }} />
                    <button
                      type="button"
                      onClick={() => { setBulkField('jobtitle'); setBulkValue(''); setBulkMode('replace'); setBulkEditOpen(true); }}
                      disabled={bulkApplying}
                      style={{ padding: '0.25rem 0.7rem', border: '1px solid #2563EB', background: '#2563EB', color: '#fff', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, cursor: bulkApplying ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                    >Bulk Edit</button>
                    <button
                      type="button"
                      onClick={applyBulkDelete}
                      disabled={bulkApplying}
                      style={{ padding: '0.25rem 0.7rem', border: '1px solid #DC2626', background: '#fff', color: '#DC2626', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, cursor: bulkApplying ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                    >Delete {bulkSelected.size}</button>
                    <button
                      type="button"
                      onClick={() => setBulkSelected(new Set())}
                      disabled={bulkApplying}
                      style={{ padding: '0.25rem 0.7rem', border: '1px solid transparent', background: 'transparent', color: '#475569', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                    >Clear</button>
                  </div>
                )}
                <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: '6px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC', position: 'sticky', top: 0, zIndex: 1 }}>
                        <th style={{ padding: '0.4rem 0.4rem', textAlign: 'center', borderBottom: '1px solid #E2E8F0', width: '34px' }}>
                          {(() => {
                            const visibleIds = companyContacts.map(c => String(c.id || c.vid || '')).filter(Boolean);
                            const allSelected = visibleIds.length > 0 && visibleIds.every(id => bulkSelected.has(id));
                            const someSelected = visibleIds.some(id => bulkSelected.has(id));
                            return (
                              <input
                                type="checkbox"
                                checked={allSelected}
                                ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }}
                                onChange={() => {
                                  setBulkSelected(prev => {
                                    const next = new Set(prev);
                                    if (allSelected) for (const id of visibleIds) next.delete(id);
                                    else for (const id of visibleIds) next.add(id);
                                    return next;
                                  });
                                }}
                                onClick={e => e.stopPropagation()}
                                title="Select all visible"
                                style={{ cursor: 'pointer' }}
                              />
                            );
                          })()}
                        </th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Name</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }} title="Where this contact was created: HubSpot sync, bulk upload, or manual entry.">Source</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Full Name</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Title</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Tags</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Category</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Email</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0', width: '60px' }} title="Outbound emails to this contact, sourced from the Activity tab.">Sent</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0', width: '70px' }} title="Inbound emails from this contact, sourced from the Activity tab.">Received</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Work Phone</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Cell Phone</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>City</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Country</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>LinkedIn</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }} title="Open LinkedIn / Sales Navigator pre-filtered to this contact's name + company.">LinkedIn Search</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Notes</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0', width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...companyContacts]
                        .sort((a, b) => {
                          const aLeft = contactHasTag(a, 'left') ? 1 : 0;
                          const bLeft = contactHasTag(b, 'left') ? 1 : 0;
                          return aLeft - bLeft;
                        })
                        .map((c, i) => {
                        const name = [c.firstname, c.lastname].filter(Boolean).join(' ');
                        const linkedinUrl = c.hs_linkedin_url || c.linkedin_url || c.hs_linkedinid;
                        const isDM = contactHasTag(c, 'decision maker');
                        const source = getContactSource(c);
                        const sourceStyle = source === 'manual'
                          ? { bg: '#EDE9FE', color: '#5B21B6', label: 'Manual' }
                          : source === 'bulk'
                          ? { bg: '#DBEAFE', color: '#1D4ED8', label: 'Bulk' }
                          : { bg: '#FFEDD5', color: '#9A3412', label: 'HubSpot' };
                        const counts = getContactEmailCounts(c);
                        const isExcluded = excludedContactIds.has(String(c.id || c.vid || ''));
                        return (
                          <tr key={c.id || i} onClick={() => setEditingContact(c)} style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer', background: isDM ? '#FEFCE8' : '', borderLeft: isDM ? '3px solid #F59E0B' : '', opacity: isExcluded ? 0.5 : 1 }} onMouseEnter={e => e.currentTarget.style.background = isDM ? '#FEF9C3' : '#F8FAFC'} onMouseLeave={e => e.currentTarget.style.background = isDM ? '#FEFCE8' : ''}>
                            <td style={{ padding: '0.35rem 0.4rem', textAlign: 'center', width: '34px' }} onClick={e => e.stopPropagation()}>
                              {(() => {
                                const cid = String(c.id || c.vid || '');
                                if (!cid) return null;
                                return (
                                  <input
                                    type="checkbox"
                                    checked={bulkSelected.has(cid)}
                                    onChange={() => setBulkSelected(prev => {
                                      const next = new Set(prev);
                                      if (next.has(cid)) next.delete(cid); else next.add(cid);
                                      return next;
                                    })}
                                    style={{ cursor: 'pointer' }}
                                  />
                                );
                              })()}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', fontWeight: 600, color: '#1E293B', whiteSpace: 'nowrap' }}>
                              {name || '-'}
                              {isDM && <span style={{ marginLeft: '0.3rem', fontSize: '0.55rem', fontWeight: 700, color: '#92400E', background: '#FDE68A', padding: '0px 5px', borderRadius: '3px' }}>DM</span>}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', whiteSpace: 'nowrap' }}>
                              <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 700, background: sourceStyle.bg, color: sourceStyle.color, letterSpacing: '0.02em' }}>{sourceStyle.label}</span>
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#1E293B', whiteSpace: 'nowrap' }}>
                              {(() => {
                                const fullFirst = c.firstname || '';
                                const fullLast = c.lastname || '';
                                const full = `${fullFirst} ${fullLast}`.trim();
                                const nicknames = (settings && settings.contactNicknames) || {};
                                const nick = (c.id && nicknames[c.id]) || '';
                                if (!full && !nick) return <span style={{ color: '#CBD5E1' }}>-</span>;
                                return (
                                  <>
                                    <span>{full || '-'}</span>
                                    {nick && <span style={{ marginLeft: '0.35rem', fontSize: '0.65rem', color: '#64748B', fontWeight: 400 }}>({nick})</span>}
                                  </>
                                );
                              })()}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.jobtitle || '-'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.68rem', color: '#475569' }}>
                              {(c.dans_tags || c.dan_s_tags || c.dans_tag || '-')}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', maxWidth: '180px' }}>
                              {(() => {
                                const matched = BUCKETS.filter(b => getContactTags(c).includes(b.tag));
                                if (matched.length === 0) return <span style={{ fontSize: '0.62rem', color: '#CBD5E1' }}>-</span>;
                                return <span style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                                  {matched.map(b => <span key={b.key} style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 700, background: b.headerBg, color: b.headerColor, whiteSpace: 'nowrap' }}>{b.label}</span>)}
                                </span>;
                              })()}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email || '-'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: counts.sent > 0 ? '#1E293B' : '#CBD5E1', fontVariantNumeric: 'tabular-nums' }} title={counts.sent > 0 ? `${counts.sent} outbound emails to this contact (Activity tab)` : 'No outbound emails recorded'}>{counts.sent || '-'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: counts.received > 0 ? '#1E293B' : '#CBD5E1', fontVariantNumeric: 'tabular-nums' }} title={counts.received > 0 ? `${counts.received} inbound emails from this contact (Activity tab)` : 'No inbound emails recorded'}>{counts.received || '-'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', whiteSpace: 'nowrap' }}>{c.phone || '-'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', whiteSpace: 'nowrap' }}>{c.mobilephone || c.mobile_phone || '-'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', whiteSpace: 'nowrap', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.city || '-'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', whiteSpace: 'nowrap', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.country || '-'}</td>
                            <td style={{ padding: '0.35rem 0.5rem' }}>
                              {linkedinUrl ? <a href={linkedinUrl.startsWith('http') ? linkedinUrl : `https://linkedin.com/in/${linkedinUrl}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#0A66C2', fontSize: '0.7rem', fontWeight: 600, textDecoration: 'none' }}>View</a> : <span style={{ color: '#CBD5E1' }}>-</span>}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem' }}>
                              {(() => {
                                const parts = [c.firstname, c.lastname, c.company || fields.company].map(s => String(s || '').trim()).filter(Boolean);
                                if (parts.length === 0) return <span style={{ color: '#CBD5E1' }}>-</span>;
                                const keywords = encodeURIComponent(parts.join(' '));
                                const liHref = `https://www.linkedin.com/search/results/people/?keywords=${keywords}`;
                                const snHref = `https://www.linkedin.com/sales/search/people?keywords=${keywords}`;
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <a
                                      href={liHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      title={`Open regular LinkedIn people search for "${parts.join(' ')}": best for grabbing the canonical linkedin.com/in/ URL.`}
                                      style={{ color: '#0A66C2', fontSize: '0.65rem', fontWeight: 600, textDecoration: 'none' }}
                                    >LinkedIn ↗</a>
                                    <a
                                      href={snHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      title={`Open Sales Navigator search pre-filtered to "${parts.join(' ')}".`}
                                      style={{ color: '#0A66C2', fontSize: '0.65rem', fontWeight: 600, textDecoration: 'none' }}
                                    >Sales Nav ↗</a>
                                  </div>
                                );
                              })()}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.68rem' }}>{(settings.contactNotes || {})[c.id || c.vid] || c.notes || c.hs_content_membership_notes || c.message || '-'}</td>
                            <td style={{ padding: '0.35rem 0.3rem', textAlign: 'center', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                              {(() => {
                                const cid = String(c.id || c.vid || '');
                                if (!cid) return null;
                                return isExcluded ? (
                                  <button
                                    onClick={e => { e.stopPropagation(); unexcludeContactFromCompany(cid); }}
                                    title="Re-add this contact to this company"
                                    style={{ background: 'none', border: 'none', color: '#059669', fontSize: '0.66rem', fontWeight: 700, cursor: 'pointer', padding: '0 4px', lineHeight: 1, fontFamily: 'inherit' }}
                                  >＋ Re-add</button>
                                ) : (
                                  <button
                                    onClick={e => { e.stopPropagation(); excludeContactFromCompany(cid); }}
                                    title="Remove from this company only (keeps the contact in HubSpot)"
                                    style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.9rem', cursor: 'pointer', padding: '0 3px', lineHeight: 1, fontFamily: 'inherit' }}
                                    onMouseEnter={e => e.currentTarget.style.color = '#F59E0B'}
                                    onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
                                  >⊘</button>
                                );
                              })()}
                              <button
                                onClick={e => { e.stopPropagation(); handleDeleteContact(c); }}
                                disabled={deletingContact === (c.id || c.vid)}
                                title="Delete contact from HubSpot (permanent)"
                                style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.85rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1, fontFamily: 'inherit' }}
                                onMouseEnter={e => e.target.style.color = '#EF4444'}
                                onMouseLeave={e => e.target.style.color = '#CBD5E1'}
                              >{deletingContact === (c.id || c.vid) ? '...' : '×'}</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                </>
              ) : (() => {
                const totalContacts = Array.isArray(hubspotContacts) ? hubspotContacts.length : 0;
                const exactCompany = totalContacts > 0
                  ? hubspotContacts.filter(c => (c.company || '').toLowerCase().trim() === (fields.company || '').toLowerCase().trim()).length
                  : 0;
                const hasEmailDomain = !!(fields.emailDomain && String(fields.emailDomain).trim());
                const hasWebsite = !!(fields.website && String(fields.website).trim());
                return (
                  <div style={{ fontSize: '0.78rem', color: '#64748B', fontStyle: 'italic', lineHeight: 1.5 }}>
                    <div>No HubSpot contacts found for this company.</div>
                    <div style={{ marginTop: '0.3rem', fontSize: '0.72rem' }}>
                      <span style={{ color: '#9CA3AF' }}>HubSpot cache: {totalContacts.toLocaleString()} contacts · Exact-name match: {exactCompany}</span>
                    </div>
                    {!hasEmailDomain && !hasWebsite && (
                      <div style={{ marginTop: '0.3rem', color: '#B45309', fontSize: '0.72rem' }}>
                        Tip: this prospect has no Email Domain or Website registered. Add the company's domain (e.g. <code>tiaa.org</code>) to the Email Domain field so contacts whose Company text differs from the prospect name still match by email.
                      </div>
                    )}
                    {totalContacts === 0 && (
                      <div style={{ marginTop: '0.3rem', color: '#B45309', fontSize: '0.72rem' }}>
                        Tip: no HubSpot contacts are cached locally. Open the HubSpot Contacts tab once to sync.
                      </div>
                    )}
                  </div>
                );
              })()}
              </div>
            </div>
          )}
        </div>
        <div className={styles.footer}>
          {!isNew && (
            <button style={{ padding: '0.5rem 1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', fontSize: 'var(--font-size-sm)', fontFamily: 'inherit', color: 'var(--color-text-secondary)', cursor: 'pointer' }} onClick={handlePrint}>
              Export PDF
            </button>
          )}
          {showSaved && (
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#059669', background: '#DCFCE7', padding: '0.25rem 0.6rem', borderRadius: '4px', animation: 'savedFadeModal 1.5s ease-out forwards' }}>
              Saved!
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button className={styles.cancelBtn} onClick={onClose}>Close</button>
          {isNew && (
            <button className={styles.saveBtn} onClick={handleSave} disabled={!fields.company.trim()}>
              Add Prospect
            </button>
          )}
        </div>
      </div>
      {bulkEditOpen && createPortal(
        (() => {
          const FIELD_OPTIONS = [
            { key: 'jobtitle', label: 'Title', mode: 'single' },
            { key: 'dans_tags', label: 'Tags / Categories', mode: 'tags' },
            { key: 'city', label: 'City', mode: 'single' },
            { key: 'country', label: 'Country', mode: 'single' },
            { key: 'notes', label: 'Notes (per-user)', mode: 'multi' },
          ];
          const def = FIELD_OPTIONS.find(f => f.key === bulkField) || FIELD_OPTIONS[0];
          const supportsMode = bulkField === 'dans_tags' || bulkField === 'notes';
          const onCancel = () => { if (!bulkApplying) { setBulkEditOpen(false); setBulkValue(''); } };
          const submitDisabled = bulkApplying || (bulkField !== 'notes' && bulkValue.trim() === '' && bulkMode === 'replace');
          // Tag chip helper for the dans_tags picker
          const tagsList = (bulkValue || '').split(';').map(s => s.trim()).filter(Boolean);
          function setTagsList(arr) { setBulkValue(arr.join(';')); }
          function toggleTag(t) {
            const lower = t.toLowerCase();
            if (tagsList.some(x => x.toLowerCase() === lower)) setTagsList(tagsList.filter(x => x.toLowerCase() !== lower));
            else setTagsList([...tagsList, t]);
          }
          return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }} onClick={onCancel}>
              <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: 520, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>Bulk Edit {bulkSelected.size} contact{bulkSelected.size === 1 ? '' : 's'}</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
                      Writes to HubSpot via the update-contact API for every selected row (Notes is per-user only and skips HubSpot).
                    </div>
                  </div>
                  <button onClick={onCancel} disabled={bulkApplying} style={{ border: 'none', background: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: bulkApplying ? 'wait' : 'pointer' }}>×</button>
                </div>
                <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', overflowY: 'auto' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>
                    Field
                    <select
                      value={bulkField}
                      onChange={e => { setBulkField(e.target.value); setBulkValue(''); setBulkMode('replace'); }}
                      disabled={bulkApplying}
                      style={{ padding: '0.4rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.85rem', fontFamily: 'inherit' }}
                    >
                      {FIELD_OPTIONS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </label>
                  {supportsMode && (
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>
                      Mode
                      <select
                        value={bulkMode}
                        onChange={e => setBulkMode(e.target.value)}
                        disabled={bulkApplying}
                        style={{ padding: '0.4rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.85rem', fontFamily: 'inherit' }}
                      >
                        <option value="replace">Replace existing value</option>
                        <option value="append">Append to existing value</option>
                      </select>
                    </label>
                  )}
                  {def.mode === 'multi' ? (
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>
                      Value
                      <textarea
                        value={bulkValue}
                        onChange={e => setBulkValue(e.target.value)}
                        disabled={bulkApplying}
                        rows={4}
                        placeholder="Enter the note text…"
                        style={{ padding: '0.45rem 0.55rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.85rem', fontFamily: 'inherit', resize: 'vertical' }}
                      />
                    </label>
                  ) : def.mode === 'tags' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <div style={{ fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>Tags</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                        {[...new Set([...TAG_OPTIONS, ...BUCKETS.map(b => b.label), ...tagsList])].map(t => {
                          const active = tagsList.some(x => x.toLowerCase() === t.toLowerCase());
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => toggleTag(t)}
                              disabled={bulkApplying}
                              style={{ padding: '0.2rem 0.55rem', border: `1px solid ${active ? '#2563EB' : '#CBD5E1'}`, background: active ? '#2563EB' : '#fff', color: active ? '#fff' : '#334155', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                            >{t}</button>
                          );
                        })}
                      </div>
                      <input
                        type="text"
                        value={bulkValue}
                        onChange={e => setBulkValue(e.target.value)}
                        disabled={bulkApplying}
                        placeholder="Or type tags as a semicolon-separated list (e.g. ESG;EU)"
                        style={{ padding: '0.4rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.8rem', fontFamily: 'inherit' }}
                      />
                      <div style={{ fontSize: '0.68rem', color: '#64748B' }}>
                        {bulkMode === 'append'
                          ? 'Appends new tags to each contact, keeping existing ones.'
                          : 'Replaces every existing tag on each contact with the list above.'}
                      </div>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>
                      Value
                      <input
                        type="text"
                        value={bulkValue}
                        onChange={e => setBulkValue(e.target.value)}
                        disabled={bulkApplying}
                        placeholder={`New ${def.label.toLowerCase()} for all selected contacts`}
                        style={{ padding: '0.4rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.85rem', fontFamily: 'inherit' }}
                      />
                    </label>
                  )}
                </div>
                <div style={{ padding: '0.7rem 1rem', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={bulkApplying}
                    style={{ padding: '0.4rem 0.9rem', border: '1px solid #CBD5E1', background: '#fff', color: '#334155', borderRadius: 4, fontSize: '0.8rem', fontWeight: 600, cursor: bulkApplying ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                  >Cancel</button>
                  <button
                    type="button"
                    onClick={applyBulkEdit}
                    disabled={submitDisabled}
                    style={{ padding: '0.4rem 0.9rem', border: '1px solid #2563EB', background: submitDisabled ? '#94A3B8' : '#2563EB', color: '#fff', borderRadius: 4, fontSize: '0.8rem', fontWeight: 600, cursor: submitDisabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                  >{bulkApplying ? 'Applying…' : `Apply to ${bulkSelected.size}`}</button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}
      {editingContact && (
        <ContactEditModal
          contact={editingContact}
          onSave={handleContactSaved}
          onClose={handleCloseContactEdit}
          tagOptions={allTagOptions}
          contactNotes={settings.contactNotes || {}}
          onSaveNote={handleSaveContactNote}
          contactOldEmails={settings.contactOldEmails || {}}
          onSaveOldEmails={handleSaveContactOldEmails}
          contactOldCompany={settings.contactOldCompany || {}}
          onSaveOldCompany={handleSaveContactOldCompany}
          onSaveCompanyOverride={(contactId, value) => {
            // value === null clears the pin; a string sets it. Stored in
            // settings.contactLocalFields, the same map App.jsx reads to
            // make _companyOverride win over the HubSpot-synced company text
            // everywhere the contact is shown.
            const next = withCompanyOverride(settings.contactLocalFields, contactId, value);
            if (next) updateSettings({ contactLocalFields: next });
          }}
          contactNicknames={settings.contactNicknames || {}}
          onSaveNickname={handleSaveContactNickname}
          contactTeamNames={settings.contactTeamNames || {}}
          onSaveTeamName={handleSaveContactTeamName}
          contactReportsTo={settings.contactReportsTo || {}}
          onSaveReportsTo={handleSaveContactReportsTo}
          ccMap={settings.ccMap || {}}
          onSaveCcMap={m => updateSettings({ ccMap: m })}
          toAlsoMap={settings.toAlsoMap || {}}
          onSaveToAlsoMap={m => updateSettings({ toAlsoMap: m })}
          contactFamilies={settings.contactFamilies || {}}
          onSaveFamily={(contactId, info) => {
            const current = settings.contactFamilies || {};
            const next = { ...current };
            const partner = String(info?.partner || '').trim();
            const kids = String(info?.kids || '').trim();
            if (!partner && !kids) delete next[contactId];
            else next[contactId] = { partner, kids };
            updateSettings({ contactFamilies: next });
          }}
          contactMetInPerson={settings.contactMetInPerson || {}}
          onSaveMetInPerson={handleSaveContactMetInPerson}
          contactInvitedToLouisville={settings.contactInvitedToLouisville || {}}
          onSaveInvitedToLouisville={handleSaveContactInvitedToLouisville}
          contactSentiment={settings.contactSentiment || {}}
          onSaveSentiment={handleSaveContactSentiment}
          contactTagReview={settings.contactTagReview || {}}
          onSaveTagReview={(cid, map) => {
            if (cid == null) return;
            updateSettings({ contactTagReview: { ...(settings.contactTagReview || {}), [cid]: map } });
          }}
          events={settings.events || []}
          onToggleContactEvent={(eventId, c) => updateSettings({ events: toggleContactInEvents(settings.events || [], eventId, c) })}
          companyContacts={companyContacts}
          emailDomains={(fields.emailDomain || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)}
          companyNames={(prospects || []).map(p => p.company).filter(Boolean)}
        />
      )}
      {contactsUploadPreview && createPortal(
        (() => {
          const { fileName, headers, rows, mapping } = contactsUploadPreview;
          const sample = rows[0] || {};
          const FIELD_OPTIONS = [
            { key: '', label: '(Ignore)' },
            { key: 'firstname', label: 'First Name' },
            { key: 'lastname', label: 'Last Name' },
            { key: 'email', label: 'Email (required)' },
            { key: 'jobtitle', label: 'Job Title' },
            { key: 'teamName', label: 'Team Name' },
            { key: 'phone', label: 'Phone' },
            { key: 'city', label: 'City' },
            { key: 'state', label: 'State' },
            { key: 'country', label: 'Country' },
            { key: 'linkedin', label: 'LinkedIn URL' },
            { key: 'dans_tags', label: 'Tags' },
            { key: 'notes', label: 'Notes' },
          ];
          const mappedFields = new Set(Object.values(mapping).filter(Boolean));
          const hasEmail = mappedFields.has('email');
          const usedCounts = {};
          for (const f of Object.values(mapping)) if (f) usedCounts[f] = (usedCounts[f] || 0) + 1;
          const hasDuplicate = Object.values(usedCounts).some(n => n > 1);

          function updateMap(header, fieldKey) {
            setContactsUploadPreview(prev => prev ? { ...prev, mapping: { ...prev.mapping, [header]: fieldKey } } : prev);
          }
          function cancel() { if (!contactsImporting) setContactsUploadPreview(null); }

          return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }} onClick={cancel}>
              <div
                onClick={e => e.stopPropagation()}
                style={{ background: '#fff', borderRadius: 10, width: 820, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}
              >
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>Map columns for import</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
                      <code>{fileName}</code>: {rows.length} row{rows.length === 1 ? '' : 's'} detected. Review each column's mapping before importing.
                    </div>
                  </div>
                  <button onClick={cancel} style={{ border: 'none', background: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer' }}>×</button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem' }}>
                  {!hasEmail && (
                    <div style={{ padding: '0.5rem 0.75rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: '0.75rem', color: '#991B1B', marginBottom: '0.5rem', fontWeight: 600 }}>
                      At least one column must be mapped to <strong>Email</strong>: rows with no email are skipped.
                    </div>
                  )}
                  {hasDuplicate && (
                    <div style={{ padding: '0.5rem 0.75rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: '0.75rem', color: '#92400E', marginBottom: '0.5rem' }}>
                      Each field can only be mapped to one column. Fix duplicate assignments below.
                    </div>
                  )}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC' }}>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>File column</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Sample row</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Maps to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {headers.map(h => {
                        const fieldKey = mapping[h] || '';
                        const duplicate = fieldKey && usedCounts[fieldKey] > 1;
                        const sampleVal = String(sample[h] ?? '').slice(0, 80);
                        return (
                          <tr key={h} style={{ borderBottom: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600, color: '#1E293B' }}>{h}</td>
                            <td style={{ padding: '0.4rem 0.5rem', color: '#64748B', fontSize: '0.72rem', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sampleVal || <span style={{ color: '#CBD5E1', fontStyle: 'italic' }}>empty</span>}</td>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <select
                                value={fieldKey}
                                onChange={e => updateMap(h, e.target.value)}
                                style={{ padding: '0.25rem 0.4rem', border: `1px solid ${duplicate ? '#DC2626' : '#E2E8F0'}`, borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', background: duplicate ? '#FEF2F2' : '#fff', color: '#1E293B', minWidth: 180 }}
                              >
                                {FIELD_OPTIONS.map(opt => (
                                  <option key={opt.key || '_ignore'} value={opt.key}>{opt.label}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button
                    onClick={cancel}
                    disabled={contactsImporting}
                    style={{ padding: '0.45rem 0.9rem', border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: contactsImporting ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                  >Cancel</button>
                  <button
                    onClick={confirmContactsImport}
                    disabled={contactsImporting || !hasEmail || hasDuplicate}
                    style={{ padding: '0.45rem 0.9rem', border: 'none', background: (!hasEmail || hasDuplicate) ? '#94A3B8' : '#7C3AED', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, cursor: (contactsImporting || !hasEmail || hasDuplicate) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                  >
                    {contactsImporting ? 'Importing…' : `Replace with ${rows.length} row${rows.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}
      {portfolioUpload && createPortal(
        (() => {
          const { fileName, headers, rows: fileRows, mapping } = portfolioUpload;
          const sampleRow = fileRows[0] || {};
          const mappedFields = new Set(Object.values(mapping).filter(Boolean));
          const hasCompanyName = mappedFields.has('companyName');
          const usedFieldCounts = {};
          for (const f of Object.values(mapping)) if (f) usedFieldCounts[f] = (usedFieldCounts[f] || 0) + 1;
          const hasDuplicateMapping = Object.values(usedFieldCounts).some(n => n > 1);
          // Which of the internal fields the upload mapping does NOT cover.
          // companyName is excluded because its own dedicated warning is shown above.
          const unmappedExpectedFields = PORTFOLIO_FIELD_OPTIONS
            .filter(opt => opt.key && opt.key !== 'companyName' && !mappedFields.has(opt.key));
          const unmappedExpected = unmappedExpectedFields.map(opt => opt.label);
          function updateMap(header, fieldKey) {
            setPortfolioUpload(prev => prev ? { ...prev, mapping: { ...prev.mapping, [header]: fieldKey } } : prev);
          }
          function cancel() { setPortfolioUpload(null); }
          function confirmImport() {
            if (!hasCompanyName) { alert('You must map at least one column to "Company Name" before importing.'); return; }
            if (hasDuplicateMapping) { alert('Each field can only be mapped once. Set duplicate mappings to "Ignore" or change one of them.'); return; }
            const parsed = fileRows
              .map(r => {
                const out = {
                  companyName: '', status: '', sector: '', subsector: '',
                  sectorScore: '', subsectorScore: '', opportunityScore: '',
                  hqCity: '', hqCountry: '',
                  energyGwh: '', siteCount: '', pcDescription: '', acquisitionYear: '',
                  notes: '',
                  raClientMatch: '', clientManager: '', targetAccount: '',
                };
                for (const [header, fieldKey] of Object.entries(mapping)) {
                  if (!fieldKey) continue;
                  const raw = String(r[header] ?? '').trim();
                  if (fieldKey === 'energyGwh') {
                    // Accept values like "850 est.", "1,200", "520 est" — keep the number.
                    const m = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
                    out.energyGwh = m ? m[0] : '';
                  } else if (fieldKey === 'siteCount') {
                    // Accept "45 (P)", "20 (E)", "5,200" — keep the number, preserve marker when present.
                    const numMatch = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
                    const markerMatch = raw.match(/\((?:[PpEe])\)/);
                    if (numMatch) {
                      out.siteCount = markerMatch ? `${numMatch[0]} ${markerMatch[0].toUpperCase()}` : numMatch[0];
                    } else {
                      out.siteCount = '';
                    }
                  } else if (fieldKey === 'opportunityScore' || fieldKey === 'sectorScore' || fieldKey === 'subsectorScore') {
                    // Accept "85%", "85/100", "85 (est.)", "1,234" — keep the numeric portion
                    // so the table shows the exact score from the uploaded file rather than
                    // silently falling back to the composite methodology. Preserve the raw
                    // cell when it has text without a number (e.g. "N/A" for credit
                    // strategies) so the scorer can distinguish "explicitly N/A" from
                    // "column not provided" and render accordingly.
                    const m = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
                    if (m) out[fieldKey] = m[0];
                    else if (raw) out[fieldKey] = raw;
                    else out[fieldKey] = '';
                  } else {
                    out[fieldKey] = raw;
                  }
                }
                return out;
              })
              .filter(r => r.companyName);
            if (parsed.length === 0) {
              alert('No rows had a non-empty Company Name: nothing to import.');
              return;
            }
            const existing = fields.portfolioCompanies || [];
            if (existing.length > 0 && !window.confirm(`Replace the current ${existing.length} portfolio compan${existing.length === 1 ? 'y' : 'ies'} with ${parsed.length} row${parsed.length === 1 ? '' : 's'} from "${fileName}"? This cannot be undone.`)) {
              return;
            }
            // Auto-fill RA Client Match / Target Account from two sources:
            //   1. savedPortfolioMappings — explicit saves the user has made.
            //   2. the existing portfolio rows being replaced — catches the
            //      case where the user had mapped companies BEFORE this
            //      feature rolled out, so nothing is in savedMappings yet.
            const savedMappings = settings.savedPortfolioMappings || {};
            const implicitMappings = {};
            for (const pr of (fields.portfolioCompanies || [])) {
              const k = (pr.companyName || '').toLowerCase().trim();
              if (!k) continue;
              const entry = implicitMappings[k] || {};
              if (pr.raClientMatch) entry.raClientMatch = pr.raClientMatch;
              if (pr.targetAccount) entry.targetAccount = pr.targetAccount;
              if (entry.raClientMatch || entry.targetAccount) implicitMappings[k] = entry;
            }
            const effectiveMappings = { ...implicitMappings, ...savedMappings };
            const withSaved = parsed.map(r => {
              const key = (r.companyName || '').toLowerCase().trim();
              const saved = key && effectiveMappings[key];
              if (!saved) return r;
              const out = { ...r };
              if (!out.raClientMatch && saved.raClientMatch) out.raClientMatch = saved.raClientMatch;
              if (!out.targetAccount && saved.targetAccount) out.targetAccount = saved.targetAccount;
              return out;
            });
            set('portfolioCompanies', withSaved);
            // Backfill savedPortfolioMappings so the mappings show the "saved"
            // marker on the new rows (and so a different device sees them too).
            if (Object.keys(implicitMappings).length > 0) {
              const mergedMappings = { ...(settings.savedPortfolioMappings || {}) };
              let dirty = false;
              for (const [k, entry] of Object.entries(implicitMappings)) {
                const prior = mergedMappings[k] || {};
                const next = { ...prior };
                let changed = false;
                if (entry.raClientMatch && prior.raClientMatch !== entry.raClientMatch) { next.raClientMatch = entry.raClientMatch; changed = true; }
                if (entry.targetAccount && prior.targetAccount !== entry.targetAccount) { next.targetAccount = entry.targetAccount; changed = true; }
                if (changed) { next.updatedAt = Date.now(); mergedMappings[k] = next; dirty = true; }
              }
              if (dirty) updateSettings({ savedPortfolioMappings: mergedMappings });
            }
            if (portfolioUpload.overview) set('portfolioOverview', portfolioUpload.overview);
            if (portfolioUpload.topFive) set('portfolioTopFive', portfolioUpload.topFive);
            // Persist the original file as a downloadable attachment for this company.
            if (portfolioUpload.file) savePortfolioSourceFile(fields.company, portfolioUpload.file);
            setPortfolioUpload(null);
          }
          return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }} onClick={cancel}>
              <div
                onClick={e => e.stopPropagation()}
                style={{ background: '#fff', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', width: 'min(780px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', fontFamily: 'inherit' }}
              >
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border-light)' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Review column mapping</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.2rem' }}>
                    <strong>{fileRows.length}</strong> row{fileRows.length === 1 ? '' : 's'} from <em>{fileName}</em>: confirm each column maps to the right field, then import.
                  </div>
                  {!hasCompanyName && (
                    <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: 6, fontSize: '0.75rem' }}>
                      A column must map to <strong>Company Name</strong> before you can import.
                    </div>
                  )}
                  {hasDuplicateMapping && (
                    <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#FFFBEB', border: '1px solid #FCD34D', color: '#854D0E', borderRadius: 6, fontSize: '0.75rem' }}>
                      Some fields are mapped by more than one column. Only one mapping can win: set duplicates to "Ignore" or change them.
                    </div>
                  )}
                  {unmappedExpected.length > 0 && (
                    <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#FFFBEB', border: '1px solid #FCD34D', color: '#854D0E', borderRadius: 6, fontSize: '0.75rem' }}>
                      <strong>{unmappedExpected.length}</strong> expected column{unmappedExpected.length === 1 ? ' is' : 's are'} not being uploaded:{' '}
                      <span style={{ fontWeight: 600 }}>{unmappedExpected.join(', ')}</span>.
                      {' '}Map a file column to each one below, or leave them blank if you don't have that data.
                    </div>
                  )}
                  {!mappedFields.has('opportunityScore') && (
                    <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#FEF3C7', border: '1px solid #F59E0B', color: '#92400E', borderRadius: 6, fontSize: '0.75rem' }}>
                      No column is mapped to <strong>Opportunity Score</strong>. Rows without an uploaded score fall back to the composite methodology
                      (0.30·Energy + 0.30·Sites + 0.25·Sector + 0.15·Year — site counts marked (E) count in full). Map the column below if you want to preserve the scores from the file verbatim.
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1.25rem' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC', textAlign: 'left' }}>
                        <th style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--color-border)', fontSize: '0.7rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>File Column</th>
                        <th style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--color-border)', fontSize: '0.7rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sample Value</th>
                        <th style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--color-border)', fontSize: '0.7rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Maps To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {headers.map(h => {
                        const fieldKey = mapping[h] || '';
                        const sample = String(sampleRow[h] ?? '').slice(0, 80);
                        const isDuplicate = fieldKey && usedFieldCounts[fieldKey] > 1;
                        const isRequiredHit = fieldKey === 'companyName';
                        return (
                          <tr key={h} style={{ borderBottom: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600, color: 'var(--color-text)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h}>{h || <em style={{ color: '#94A3B8' }}>(blank header)</em>}</td>
                            <td style={{ padding: '0.4rem 0.5rem', color: '#64748B', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: sample ? 'normal' : 'italic' }} title={String(sampleRow[h] ?? '')}>{sample || '(empty)'}</td>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <select
                                value={fieldKey}
                                onChange={e => updateMap(h, e.target.value)}
                                style={{
                                  width: '100%', padding: '0.3rem 0.4rem',
                                  border: `1px solid ${isDuplicate ? '#FCD34D' : (isRequiredHit ? '#86EFAC' : 'var(--color-border)')}`,
                                  background: isDuplicate ? '#FFFBEB' : (isRequiredHit ? '#F0FDF4' : '#fff'),
                                  borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit',
                                  color: fieldKey ? 'var(--color-text)' : '#94A3B8',
                                }}
                              >
                                {PORTFOLIO_FIELD_OPTIONS.map(o => (
                                  <option key={o.key} value={o.key}>{o.label}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                      {unmappedExpectedFields.map(field => (
                        <tr key={`__missing__${field.key}`} style={{ borderBottom: '1px solid #F1F5F9', background: '#FFFBEB' }}>
                          <td style={{ padding: '0.4rem 0.5rem', fontStyle: 'italic', color: '#854D0E', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`No column in your file maps to ${field.label}`}>
                            (no file column)
                          </td>
                          <td style={{ padding: '0.4rem 0.5rem', color: '#A16207', fontStyle: 'italic' }}>-</td>
                          <td style={{ padding: '0.4rem 0.5rem' }}>
                            <div
                              title={`No file column maps to "${field.label}". Choose this field in the Maps To dropdown of one of the rows above to populate it on import, or leave it blank.`}
                              style={{
                                width: '100%',
                                padding: '0.3rem 0.5rem',
                                border: '1px solid #FCD34D',
                                background: '#FEF9C3',
                                borderRadius: 4,
                                fontSize: '0.75rem',
                                fontFamily: 'inherit',
                                color: '#854D0E',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '0.4rem',
                              }}
                            >
                              <span>Missing: {field.label}</span>
                              <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.05rem 0.4rem', border: '1px solid #FCD34D', borderRadius: 10, background: '#fff' }}>not uploaded</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--color-border-light)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={cancel}
                    style={{ padding: '0.4rem 0.9rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer' }}
                  >Cancel</button>
                  <button
                    type="button"
                    onClick={confirmImport}
                    disabled={!hasCompanyName || hasDuplicateMapping}
                    style={{ padding: '0.4rem 0.9rem', border: 'none', background: (!hasCompanyName || hasDuplicateMapping) ? '#CBD5E1' : 'var(--color-accent)', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit', cursor: (!hasCompanyName || hasDuplicateMapping) ? 'not-allowed' : 'pointer', fontWeight: 600 }}
                  >Import {fileRows.length} row{fileRows.length === 1 ? '' : 's'}</button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}
      {mergeOpen && createPortal(
        <div
          onClick={() => setMergeOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', width: 'min(520px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', fontFamily: 'inherit' }}
          >
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1E293B' }}>Merge another record into "{fields.company}"</div>
              <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 4 }}>
                Pick the duplicate record. We'll pull any missing fields into this record (this one wins where both have values, arrays get combined) and delete the duplicate.
              </div>
            </div>
            <div style={{ padding: '0.6rem 1.25rem', borderBottom: '1px solid #F1F5F9' }}>
              <input
                autoFocus
                type="text"
                value={mergeQuery}
                onChange={e => setMergeQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setMergeOpen(false); }}
                placeholder="Search prospects…"
                style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.82rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.4rem 0' }}>
              {(() => {
                const q = mergeQuery.trim().toLowerCase();
                const list = prospects
                  .filter(p => p.id !== prospect.id && (p.company || '').trim())
                  .filter(p => !q || (p.company || '').toLowerCase().includes(q));
                list.sort((a, b) => {
                  // Boost matches on the current company name first — duplicates
                  // usually share exact or near-exact names.
                  const targetNorm = (fields.company || '').toLowerCase().trim();
                  const aNear = (a.company || '').toLowerCase().trim() === targetNorm;
                  const bNear = (b.company || '').toLowerCase().trim() === targetNorm;
                  if (aNear !== bNear) return aNear ? -1 : 1;
                  return (a.company || '').localeCompare(b.company || '');
                });
                if (!list.length) {
                  return <div style={{ padding: '1rem 1.25rem', color: '#94A3B8', fontSize: '0.78rem', textAlign: 'center' }}>No matching prospects</div>;
                }
                return list.slice(0, 50).map(p => {
                  const isLikelyDupe = (p.company || '').toLowerCase().trim() === (fields.company || '').toLowerCase().trim();
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => performMerge(p)}
                      style={{ width: '100%', textAlign: 'left', padding: '0.5rem 1.25rem', border: 'none', background: isLikelyDupe ? '#FEF3C7' : '#fff', cursor: 'pointer', fontFamily: 'inherit', borderBottom: '1px solid #F1F5F9' }}
                      onMouseEnter={e => e.currentTarget.style.background = isLikelyDupe ? '#FDE68A' : '#F8FAFC'}
                      onMouseLeave={e => e.currentTarget.style.background = isLikelyDupe ? '#FEF3C7' : '#fff'}
                    >
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1E293B' }}>{p.company}</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748B', marginTop: 2 }}>
                        {[p.type, p.status, p.cdm].filter(Boolean).join(' · ') || 'no details'}
                        {isLikelyDupe && <span style={{ color: '#92400E', marginLeft: 6, fontWeight: 700 }}>· likely duplicate</span>}
                      </div>
                    </button>
                  );
                });
              })()}
            </div>
            <div style={{ padding: '0.6rem 1.25rem', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setMergeOpen(false)}
                style={{ padding: '0.4rem 0.9rem', border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff', fontSize: '0.78rem', fontFamily: 'inherit', cursor: 'pointer', color: '#475569' }}
              >Cancel</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
