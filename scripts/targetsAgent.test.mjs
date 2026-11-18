// node scripts/targetsAgent.test.mjs
import assert from 'node:assert/strict';
import { targetsAgentRows, targetsAgentPromptBlock, DEFAULT_AI_PROMPT_TARGETS, TARGETS_AGENT_DEFAULT_BATCH } from '../src/utils/targetsAgent.js';
import { parsePastedTargets, hasTargetValues, mergePastedTargets } from '../src/utils/companyTargets.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (err) { failed += 1; console.log(`FAIL ${name}\n  ${err.message}`); }
}

const prospects = [
  { id: 'p1', company: 'Zeta Corp', status: 'Client', tier: 'Tier 1', website: 'https://www.zeta.com' },
  { id: 'p2', company: 'Acme, Inc.', status: 'Qualifying', tier: 'Tier 3' },
  { id: 'p3', company: 'Snoozed Co', status: 'Client' },
];
const issues = [
  { id: 'no-targets:p1', source: 'Clients', type: 'No targets', prospectId: 'p1', resolve: { kind: 'noTargets' } },
  { id: 'x', source: 'Clients', type: 'No expiration date', prospectId: 'p1', resolve: { kind: 'other' } },
  { id: 'key-contact-no-targets:p2', source: 'Key Contacts', type: 'Key Contact company has no targets', prospectId: 'p2', resolve: { kind: 'noTargets' } },
  { id: 'prospect-no-targets:p2', source: 'Prospects', type: 'No targets', prospectId: 'p2', resolve: { kind: 'noTargets' } },
  { id: 'no-targets:p3', source: 'Clients', type: 'No targets', prospectId: 'p3', resolve: { kind: 'noTargets' }, snoozed: true },
  { id: 'no-targets:gone', source: 'Clients', type: 'No targets', prospectId: 'gone', resolve: { kind: 'noTargets' } },
];

test('lists the Issues tab no-targets companies once each, sorted, less snoozed and missing ones', () => {
  const rows = targetsAgentRows(issues, prospects);
  assert.deepEqual(rows.map(r => [r.id, r.company, r.source]), [
    ['p2', 'Acme, Inc.', 'Key Contacts'],
    ['p1', 'Zeta Corp', 'Clients'],
  ]);
  assert.equal(rows[1].prospect, prospects[0]);
});

test('each row carries the same ChatGPT link the Search web menu opens', () => {
  const [acme, zeta] = targetsAgentRows(issues, prospects);
  assert.ok(acme.chatgptUrl.startsWith('https://chatgpt.com/?hints=search&q='));
  assert.ok(decodeURIComponent(acme.chatgptUrl).includes('targets that Acme has publicly set'));
  assert.ok(decodeURIComponent(zeta.chatgptUrl).includes('Zeta (website: zeta.com)'));
});

test('the prompt block lists the first N companies', () => {
  const rows = targetsAgentRows(issues, prospects);
  assert.equal(targetsAgentPromptBlock(rows), 'Company\tListed under\nAcme, Inc.\tKey Contacts\nZeta Corp\tClients');
  assert.equal(targetsAgentPromptBlock(rows, 1), 'Company\tListed under\nAcme, Inc.\tKey Contacts');
  assert.equal(targetsAgentPromptBlock(rows, 'junk').split('\n').length, 3);
  assert.equal(targetsAgentPromptBlock([]), 'Company\tListed under');
  assert.ok(TARGETS_AGENT_DEFAULT_BATCH > 0);
});

test('the prompt names the buttons the Targets tab really has', () => {
  for (const label of ['Search web', 'Ask ChatGPT for a targets table (free)', 'Paste targets', 'AI Prompt (Targets)']) {
    assert.ok(DEFAULT_AI_PROMPT_TARGETS.includes(label), label);
  }
  assert.ok(!DEFAULT_AI_PROMPT_TARGETS.includes('—'));
});

test('the table ChatGPT is asked for pastes in and clears the issue, a no-target answer included', () => {
  const header = 'Action | Target Type | Value | Commitment Type | Year Set | Base Year | Target Year | Target Year 2 | Scope | Classification | Status | Date Published | Source';
  const some = parsePastedTargets(`${header}\nTarget | Net zero | | | 2021 | 2019 | 2040 | | 1, 2, 3 | 1.5°C | Self-declared | | https://example.com/esg`);
  assert.equal(some.rows.length, 1);
  assert.ok(hasTargetValues(mergePastedTargets([], some.rows).list));
  const none = parsePastedTargets(`${header}\n- | No target set`);
  assert.ok(hasTargetValues(mergePastedTargets([], none.rows).list));
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
