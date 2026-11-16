// Company pin review: which recovered pins look like moving a contact back
// to a job they left, and which pins on contacts now came back from a backup.
//
// Run: node scripts/companyPinReview.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { pinRisk, findSuspectPins, pinRecoveryRows } = await import('../src/utils/companyPinReview.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// pinRisk
ok(pinRisk({ company: '' }, 'Apollo') === '', 'no HubSpot company: a lost pin, not a risk');
ok(pinRisk({ company: 'Apollo Global Management, Inc.' }, 'Apollo Global Management') === '', 'a spelling of the same company is not a risk');
ok(pinRisk({ company: 'Blackstone' }, 'Apollo') === 'HubSpot has them at Blackstone', 'a different company in HubSpot is a risk');
ok(pinRisk({ company: 'Changed Jobs' }, 'Apollo') === 'HubSpot has them as Changed Jobs', 'Changed Jobs is a risk');
ok(pinRisk({ company: 'Apollo', dans_tags: 'Key;Left' }, 'Apollo') === 'Tagged Left', 'tagged Left is a risk even at the same company');
ok(pinRisk({ company: 'Apollo', dans_tags: 'Leftover' }, 'Apollo') === '', 'a tag that only contains "left" is not Left');

// findSuspectPins
const contacts = [
  { id: '1', firstname: 'Scott', lastname: 'Farmer', company: 'New Co' },      // recovered pin, moved jobs
  { id: '2', firstname: 'Ann', lastname: 'Typed', company: 'Parent Holdings' }, // pin typed on purpose, never gone
  { id: '3', firstname: 'Bob', lastname: 'Same', company: 'OXEA GmbH' },       // pin matches HubSpot
  { id: '4', firstname: 'Cat', lastname: 'NotAccount', company: 'Elsewhere' }, // pin isn't an account
  { id: '5', firstname: 'Dee', lastname: 'Left', company: 'Changed Jobs' },    // recovered, Changed Jobs
];
const localFields = {
  1: { _companyOverride: 'OXEA' },
  2: { _companyOverride: 'Apollo' },
  3: { _companyOverride: 'OXEA' },
  4: { _companyOverride: 'Somewhere' },
  5: { _companyOverride: 'Apollo' },
};
const accountNames = new Set(['oxea', 'apollo']);
const sources = [
  // Deliberately out of order: the oldest first.
  { label: 'old', at: 100, data: { contactLocalFields: { 1: { _companyOverride: 'OXEA' }, 2: { _companyOverride: 'Apollo' }, 5: { _companyOverride: 'Apollo' } } } },
  { label: 'newest', at: 300, data: { contactLocalFields: { 1: { _companyOverride: 'OXEA' }, 2: { _companyOverride: 'Apollo' }, 5: { _companyOverride: 'Apollo' } } } },
  { label: 'wiped', at: 200, data: { contactLocalFields: { 2: { _companyOverride: 'Apollo' }, 5: {} } } },
];
const rows = findSuspectPins({ contacts, localFields, accountNames, sources });
const byId = Object.fromEntries(rows.map(r => [r.id, r]));
ok(rows.length === 3, `three suspects (got ${rows.map(r => r.id).join(',')})`);
ok(byId['1']?.restored === true, 'a pin missing from a newer backup and held in an older one was restored');
ok(byId['1']?.from === 'missing in wiped, held in old', `from names the backups (${byId['1']?.from})`);
ok(byId['5']?.restored === true && byId['5']?.why === 'HubSpot has them as Changed Jobs', 'Changed Jobs contact restored');
ok(byId['2']?.restored === false, 'a pin present in every backup was typed, not restored');
ok(!byId['3'] && !byId['4'], 'matching and non-account pins are not suspects');
ok(rows[0].restored && rows[1].restored && !rows[2].restored, 'restored rows come first');

// pinRecoveryRows
const found = [
  { id: '1', value: 'OXEA', from: 'cloud backup 2026-11-01' },
  { id: '9', value: 'Apollo', from: 'browser' },
];
const recovery = pinRecoveryRows(found, new Map([['1', contacts[0]], ['9', { id: '9', firstname: 'Eve', company: 'Apollo LLC' }]]));
ok(recovery[0].id === '1' && recovery[0].tick === false, 'a pin that would move someone back starts unticked, listed first');
ok(recovery[1].id === '9' && recovery[1].tick === true, 'a pin matching HubSpot starts ticked');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
