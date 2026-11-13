// gates.explain (the All page's "Why isn't someone here?" lookup) must agree
// with the gates themselves, and name the rule that keeps a contact off.
import { makeRosterGates } from '../src/utils/contactRosters.js';

let passed = 0, failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed += 1; else { failed += 1; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

const CDM = 'Dan Baldauf';
const recent = new Date(Date.now() - 5 * 86400000).toISOString();
const prospects = [
  { company: 'Blackstone', status: 'Qualifying', cdm: CDM, tier: 'Tier 1' },
  { company: 'Acme', status: 'Client', cdm: CDM, emailDomain: 'acme.com' },
  { company: 'Oldco', status: 'Old Client', cdm: CDM },
  { company: 'Opped', status: 'Prospect', cdm: CDM, tier: 'Tier 2' },
  { company: 'Gone', status: 'Client', cdm: CDM, website: 'gone.com' },
];
const opps = [{ Account: 'Opped', Stage: 'Proposal' }];
const gates = makeRosterGates({ prospects, cdmName: CDM, oppsRecords: opps, clientStatusMap: { gone: 'Cancelling for Sure' } });
const ct = (company, tags, extra = {}) => ({ id: `${company}|${tags}`, firstname: 'A', lastname: 'B', email: `a@${(company || 'x').toLowerCase()}.com`, company, dans_tags: tags, ...extra });

const contacts = [
  ct('Blackstone', 'Dan Key Target;Decision Maker'),
  ct('Blackstone', 'Decision Maker;Hide'),
  ct('Blackstone', 'Left'),
  ct('Acme', ''),
  ct('Oldco', ''),
  ct('Opped', 'Decision Maker', { hs_email_last_open_date: recent }),
  ct('Opped', '', {}),
  ct('Gone', 'Dan Key Target'),
  ct('Nobody Inc', 'Decision Maker'),
  ct('', '', { email: 'x@gmail.com' }),
];
for (const c of contacts) {
  const ex = gates.explain(c);
  check(`explain agrees with categorize: ${c.id}`, ex.on, ex.blocked ? [] : gates.categorize(c));
  check(`explain agrees with rosterSelector: ${c.id}`, ex.on.length > 0, gates.rosterSelector(c));
}
const why = (c, label) => gates.explain(c).rosters.find(r => r.label === label).why;
check('Key + Key Prospect for a tagged DM at an untouched Tier 1', gates.explain(contacts[0]).on, ['Key', 'Key Prospect']);
check('Hide is named', /Hide/.test(gates.explain(contacts[1]).blocked), true);
check('Left is named', /Left/.test(gates.explain(contacts[2]).blocked), true);
check('Client by name', gates.explain(contacts[3]).on, ['Client']);
check('Old Client is named', why(contacts[4], 'Client'), '"Oldco" is an Old Client.');
check('Active via open opp + recent email, and still a Key Prospect', gates.explain(contacts[5]).on, ['Active', 'Key Prospect']);
check('opps no longer block Key Prospect', why(contacts[5], 'Key Prospect'), '');
check('no recent email is named', /last 90 days/.test(why(contacts[6], 'Active')), true);
check('Cancelling account is named', /Cancelling for Sure/.test(gates.explain(contacts[7]).blocked), true);
check('no tier account is named', /does not match a Tier/.test(why(contacts[8], 'Key Prospect')), true);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
