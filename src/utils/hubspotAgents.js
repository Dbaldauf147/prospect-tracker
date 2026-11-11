// The Hubspot Mapping page's Agents subtab: prompts for a browser agent
// working in HubSpot, each copied with the rows it should work through, the
// way the Agents page copies its prompts. The prompts are the user's own,
// kept in settings.hubspotMappingAgents so they follow him to his other
// machine; until he touches them the built-in agents below are shown.
//
// Pure, so scripts/hubspotAgents.test.mjs can hold it still.

import { matchesCdm } from './cdmMatch.js';
import { MAPPING_STATUS } from './hubspotMapping.js';
import { domainKey } from './seHubspotExisting.js';

export const HUBSPOT_AGENTS_SETTINGS_KEY = 'hubspotMappingAgents';

// The rows a prompt can carry. '' is a prompt copied on its own.
export const AGENT_DATA = {
  activity: 'activity',
  owners: 'owners',
  none: '',
};

export const AGENT_DATA_LABELS = {
  [AGENT_DATA.activity]: 'My Accounts mapped to HubSpot',
  [AGENT_DATA.owners]: 'Company owner changes',
  [AGENT_DATA.none]: 'No data (prompt only)',
};

export const NO_OWNER = 'No owner';

const DEFAULT_MAP_ACTIVITY_PROMPT = `1.  I am logged into HubSpot. Work through the companies in the table below, one at a time.
2.  Open the company in HubSpot: go to the Record ID, or search Companies for the HubSpot Company name.
3.  Look at the contacts whose email address is at the company's Domain. For each email, call and meeting logged on those contacts in the last 90 days, make sure it is associated with this company. If one is on a contact at this domain but not on the company, add the company association.
4.  Only add associations. Do not change an activity's owner, date or content, and do not delete anything.
5.  You have full permission to save associations as needed throughout this workflow. Do not ask for confirmation. Automatically proceed to the next company.
6.  When you finish, list every company you changed with how many activities you associated, and any company you could not find.`;

const DEFAULT_COMPANY_OWNERS_PROMPT = `1.  I am logged into HubSpot. Work through the companies in the table below, one at a time.
2.  Open the company in HubSpot: go to the Record ID, or search Companies for the HubSpot Company name. When Record ID is blank, the company was not in my HubSpot export: search Companies for the Domain, then the My Accounts Company name. If there is more than one record, change each. If you cannot find it, skip it.
3.  Set the Company owner to the value in the New Owner column. "${NO_OWNER}" means clear the Company owner field so the company is unassigned.
4.  Only change the Company owner field. Do not change contacts, deals, activities or any other property.
5.  You have full permission to save changes as needed throughout this workflow. Do not ask for confirmation. Automatically proceed to the next company.
6.  When you finish, list every company you changed with its old and new owner, and any company you could not find.`;

export const HUBSPOT_OWNED_EXPORT_REPORT_URL = 'https://app.hubspot.com/reports-list/51444280/448300388';

const DEFAULT_LATEST_OWNED_EXPORT_PROMPT = `1.  I am logged into HubSpot and into Prospect Tracker. Do this once, start to finish.
2.  Go to ${HUBSPOT_OWNED_EXPORT_REPORT_URL}
3.  Click Actions, then click Export unsummarized data.
4.  A pop up opens. Click Export.
5.  HubSpot shows: "Your file is being prepared now. When it's ready, a link to your file will appear in your notification center. You'll also receive a confirmation email." That means it worked.
6.  Click the bell icon in the top right-hand corner of HubSpot. When the top row says your file is ready to download, click it. If it isn't there yet, wait 30 seconds, close the notifications and click the bell again (try for up to 5 minutes).
7.  Clicking it downloads a zip file to my computer's Downloads folder. You don't need to open it: Prospect Tracker reads the zip as is.
8.  Go to Prospect Tracker (https://prospect-tracker-ashen.vercel.app/), open My Accounts, then the Hubspot Mapping tab, then the Mapping subtab.
9.  Click the box that says "Drop your HubSpot companies export here". In the file window that opens, go to the Downloads folder, pick the newest zip from HubSpot (the one just downloaded) and click Open. This step needs control of my computer (computer use); if you only have the browser, stop here and tell me the zip is in Downloads so I can drop it on the box myself.
10. You have full permission to export, download and upload as needed throughout this workflow. Do not ask for confirmation.
11. When you finish, say how many HubSpot companies the box now says it read, or where it stopped and why.`;

export const DEFAULT_HUBSPOT_AGENTS = [
  { id: 'map-activity', title: 'Map Activity on My Accounts', data: AGENT_DATA.activity, prompt: DEFAULT_MAP_ACTIVITY_PROMPT },
  { id: 'company-owners', title: 'Update HubSpot Company Owners', data: AGENT_DATA.owners, prompt: DEFAULT_COMPANY_OWNERS_PROMPT },
  { id: 'latest-owned-export', title: "Add Dan's Latest Hubspot Owned Companies", data: AGENT_DATA.none, prompt: DEFAULT_LATEST_OWNED_EXPORT_PROMPT },
];

const BUILT_IN = new Map(DEFAULT_HUBSPOT_AGENTS.map(a => [a.id, a]));

/** The built-in agent an id names, for Reset to default; null for the user's own. */
export function builtInAgent(id) {
  return BUILT_IN.get(id) || null;
}

// The built-in agents a saved list has already been offered, so one added to
// the app later still shows up on a list saved before it, but one the user
// deleted stays deleted. A list saved before this key existed had seen the
// first two.
export const HUBSPOT_AGENTS_KNOWN_KEY = 'hubspotMappingAgentsKnown';
const FIRST_BUILT_INS = ['map-activity', 'company-owners'];

/** The settings patch that saves an edited agent list. */
export function hubspotAgentsPatch(agents) {
  return { [HUBSPOT_AGENTS_SETTINGS_KEY]: agents, [HUBSPOT_AGENTS_KNOWN_KEY]: DEFAULT_HUBSPOT_AGENTS.map(a => a.id) };
}

/** The agents to show: the saved list plus any built-in it hasn't seen, else the built-ins. */
export function readHubspotAgents(settings) {
  const saved = settings?.[HUBSPOT_AGENTS_SETTINGS_KEY];
  if (!Array.isArray(saved)) return DEFAULT_HUBSPOT_AGENTS;
  const knownList = settings?.[HUBSPOT_AGENTS_KNOWN_KEY];
  const known = new Set(Array.isArray(knownList) ? knownList : FIRST_BUILT_INS);
  const ids = new Set(saved.map(a => a?.id && String(a.id)));
  const unseen = DEFAULT_HUBSPOT_AGENTS.filter(a => !known.has(a.id) && !ids.has(a.id));
  return [...saved, ...unseen]
    .filter(a => a && a.id)
    .map(a => ({
      id: String(a.id),
      title: String(a.title || '').trim() || 'Untitled agent',
      data: Object.values(AGENT_DATA).includes(a.data) ? a.data : AGENT_DATA.none,
      prompt: String(a.prompt ?? ''),
    }));
}

/**
 * The agents with the one whose id is `id` moved to position `to` (counted
 * in the list as it is now, clamped to its ends): the Agents subtab's drag
 * and arrow buttons. Unknown id or no move gives the same list back.
 */
export function moveAgent(agents, id, to) {
  const list = Array.isArray(agents) ? agents : [];
  const from = list.findIndex(a => a?.id === id);
  if (from < 0) return list;
  const dest = Math.max(0, Math.min(list.length - 1, Number(to) || 0));
  if (dest === from) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(dest, 0, item);
  return next;
}

// A HubSpot record's id when the export had one; the row numbers that stand
// in for a missing Company ID column are no use in HubSpot.
const recordId = (c) => (/^row-\d+$/.test(String(c?.id || '')) ? '' : String(c?.id || ''));

/**
 * Map Activity's rows: every HubSpot company an active, matched account maps
 * to. One row per HubSpot record, so an account with two gets both.
 */
export function activityAgentRows(mapping = [], isInactive = () => false) {
  const out = [];
  for (const r of mapping || []) {
    if (r.status !== MAPPING_STATUS.matched || !r.account || isInactive(r)) continue;
    for (const c of r.hubspot || []) {
      out.push({
        key: `${r.key}:${c.id}`,
        company: r.account.company || '',
        hubspotName: c.name || '',
        recordId: recordId(c),
        domain: c.domain || '',
        owner: c.owner || '',
        lastActivity: c.lastActivity || '',
      });
    }
  }
  return out;
}

/**
 * Company Owners' rows, each with the owner it should have:
 *   - an active, matched account's HubSpot company owned by someone else or
 *     by nobody goes to `ownerName`;
 *   - an active account the export has no company for (Only in My
 *     Accounts) goes to `ownerName` too. The export is of his own
 *     companies, so one missing from it is most likely owned by someone
 *     else or nobody; the row has no Record ID, and the agent finds it by
 *     domain or name;
 *   - a HubSpot company only in HubSpot (not one of My Accounts) that is
 *     owned by `ownerName` comes off him ("No owner").
 * Inactive accounts are left as they are either way.
 */
export function ownerAgentRows(mapping = [], ownerName = '', isInactive = () => false) {
  if (!ownerName) return [];
  const out = [];
  for (const r of mapping || []) {
    if (r.status === MAPPING_STATUS.matched && r.account && !isInactive(r)) {
      for (const c of r.hubspot || []) {
        if (c.owner && matchesCdm(c.owner, ownerName)) continue;
        out.push({ key: `${r.key}:${c.id}`, company: r.account.company || '', hubspotName: c.name || '', recordId: recordId(c), domain: c.domain || '', owner: c.owner || '', newOwner: ownerName, why: 'One of My Accounts' });
      }
    } else if (r.status === MAPPING_STATUS.accountOnly && r.account && !isInactive(r)) {
      const maybe = (r.suggestions || []).map(m => m.name).filter(Boolean);
      out.push({
        key: r.key, company: r.account.company || '', hubspotName: '', recordId: '',
        domain: domainKey(r.account.website) || domainKey(r.account.emailDomain), owner: '', newOwner: ownerName,
        why: `Not in your HubSpot export${maybe.length ? ` (possible match: ${maybe.join(', ')})` : ''}`,
      });
    } else if (r.status === MAPPING_STATUS.hubspotOnly) {
      for (const c of r.hubspot || []) {
        if (!c.owner || !matchesCdm(c.owner, ownerName)) continue;
        out.push({ key: `${r.key}:${c.id}`, company: '', hubspotName: c.name || '', recordId: recordId(c), domain: c.domain || '', owner: c.owner, newOwner: NO_OWNER, why: 'Not one of My Accounts' });
      }
    }
  }
  return out;
}

const COLUMNS = {
  [AGENT_DATA.activity]: [
    ['My Accounts Company', 'company'], ['HubSpot Company', 'hubspotName'], ['Record ID', 'recordId'],
    ['Domain', 'domain'], ['Company Owner', 'owner'], ['Last Activity', 'lastActivity'],
  ],
  [AGENT_DATA.owners]: [
    ['My Accounts Company', 'company'], ['HubSpot Company', 'hubspotName'], ['Record ID', 'recordId'], ['Domain', 'domain'],
    ['Current Owner', 'owner'], ['New Owner', 'newOwner'], ['Why', 'why'],
  ],
};

/** The rows as a tab-separated block with a header line, '' when there are none. */
export function agentDataBlock(data, rows = []) {
  const cols = COLUMNS[data];
  if (!cols || !rows.length) return '';
  const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  return [cols.map(c => c[0]).join('\t'), ...rows.map(r => cols.map(c => cell(r[c[1]])).join('\t'))].join('\n');
}

/** What Copy full prompt copies: the prompt, then its rows when it has any. */
export function fullAgentPrompt(prompt, block) {
  const p = String(prompt || '').trim();
  return block ? `${p}\n\n${block}` : p;
}
