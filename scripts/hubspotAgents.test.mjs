// Assertion tests for the Hubspot Mapping page's Agents subtab
// (src/utils/hubspotAgents.js). Plain Node. Run:
//   node scripts/hubspotAgents.test.mjs
import {
  readHubspotAgents, DEFAULT_HUBSPOT_AGENTS, builtInAgent, activityAgentRows, ownerAgentRows,
  agentDataBlock, fullAgentPrompt, AGENT_DATA, NO_OWNER,
} from '../src/utils/hubspotAgents.js';
import { buildHubspotMapping, compactMappingCompanies } from '../src/utils/hubspotMapping.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// the agent list
check('untouched settings show the two built-in agents', readHubspotAgents({}).map(a => a.id), ['map-activity', 'company-owners']);
check('a saved list wins, even empty', readHubspotAgents({ hubspotMappingAgents: [] }), []);
check('a saved agent with an unknown data kind is prompt only',
  readHubspotAgents({ hubspotMappingAgents: [{ id: 'x', title: '', data: 'bogus', prompt: 'Hi' }] }),
  [{ id: 'x', title: 'Untitled agent', data: '', prompt: 'Hi' }]);
check('built-in agents can be reset; your own cannot', [!!builtInAgent('map-activity'), builtInAgent('x')], [true, null]);
check('no built-in prompt has an em dash', DEFAULT_HUBSPOT_AGENTS.some(a => /—/.test(a.prompt + a.title)), false);

// rows
const accts = [
  { id: 'm', company: 'Mine Co', status: 'Prospect' },
  { id: 'o', company: 'Other Co', status: 'Prospect' },
  { id: 'n', company: 'Nobody Co', status: 'Prospect' },
  { id: 'i', company: 'Gone Co', status: 'Old Client' },
  { id: 'x', company: 'Absent Co', status: 'Prospect', website: 'https://www.absent.com/' },
  { id: 'y', company: 'Gone Missing Co', status: 'Old Client' },
];
const cos = compactMappingCompanies([
  { 'Company ID': '11', 'Company name': 'Mine Co', 'Company owner': 'Dan Baldauf', 'Company Domain Name': 'mine.com', 'Last Activity Date': '2026-10-01' },
  { 'Company ID': '12', 'Company name': 'Other Co', 'Company owner': 'Sam Ouimet' },
  { 'Company ID': '13', 'Company name': 'Nobody Co', 'Company owner': '' },
  { 'Company ID': '14', 'Company name': 'Gone Co', 'Company owner': 'Sam Ouimet' },
  { 'Company ID': '15', 'Company name': 'Loose Co', 'Company owner': 'Dan Baldauf' },
  { 'Company ID': '16', 'Company name': 'Stranger Co', 'Company owner': 'Sam Ouimet' },
]);
const mp = buildHubspotMapping(accts, cos);
const inactive = (r) => r.account?.status === 'Old Client';

const act = activityAgentRows(mp, inactive);
check('activity rows are the active matched accounts', act.map(r => r.company).sort(), ['Mine Co', 'Nobody Co', 'Other Co']);
check('an activity row carries the record', act.find(r => r.company === 'Mine Co'),
  { key: act.find(r => r.company === 'Mine Co').key, company: 'Mine Co', hubspotName: 'Mine Co', recordId: '11', domain: 'mine.com', owner: 'Dan Baldauf', lastActivity: '2026-10-01' });

const own = ownerAgentRows(mp, 'Dan Baldauf', inactive);
check('owner changes: others and nobody to Dan, a HubSpot-only company of his to no owner',
  own.map(r => [r.hubspotName, r.newOwner]).sort(),
  [['', 'Dan Baldauf'], ['Loose Co', NO_OWNER], ['Nobody Co', 'Dan Baldauf'], ['Other Co', 'Dan Baldauf']]);
const missing = own.find(r => r.company === 'Absent Co');
check('an active account missing from the export goes to Dan, found by domain', missing && [missing.recordId, missing.domain, missing.owner, missing.newOwner, missing.why],
  ['', 'absent.com', '', 'Dan Baldauf', 'Not in your HubSpot export']);
check('an inactive account missing from the export is left alone', own.some(r => r.company === 'Gone Missing Co'), false);
check('no CDM name, no owner changes', ownerAgentRows(mp, '', inactive), []);

// copying
const block = agentDataBlock(AGENT_DATA.owners, own.filter(r => r.hubspotName === 'Other Co'));
check('the block is a header line and tab-separated rows', block, 'My Accounts Company\tHubSpot Company\tRecord ID\tDomain\tCurrent Owner\tNew Owner\tWhy\nOther Co\tOther Co\t12\t\tSam Ouimet\tDan Baldauf\tOne of My Accounts');
check('no rows, no block', agentDataBlock(AGENT_DATA.activity, []), '');
check('prompt only copies the prompt', fullAgentPrompt(' Do it. ', ''), 'Do it.');
check('a prompt with rows has them after a blank line', fullAgentPrompt('Do it.', 'A\tB'), 'Do it.\n\nA\tB');
check('tabs and line breaks in a cell are flattened', agentDataBlock(AGENT_DATA.activity, [{ company: 'A\tB\nC' }]).split('\n')[1].split('\t')[0], 'A B C');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
