// Assertion tests for the decision-maker mapping behind step 8 of the
// Prospecting ladder ("Cold prospect outreach"). Plain Node — no test
// framework (the project has none). Run:
//   node scripts/decisionMakerCoverage.test.mjs
//
// The step's table makes four claims that are each easy to get quietly
// wrong, and every one of them would send the user to the wrong accounts:
//
//   1. Who counts as a decision maker. The tag, minus the contacts every
//      other page hides — Hide, Left, Schneider. A "Left" contact marking
//      an account mapped is the worst of these: the row disappears and
//      nobody is actually there to ring.
//   2. Which accounts the percentage is over. This CDM's, in that tier,
//      clients excluded — the same universe the Key Prospects page's
//      missing-DM banner counts, since the two now share this module.
//   3. One tier at a time, in order. Tier 2 hands over rows only once
//      Tier 1 has none left, and an empty tier is skipped rather than
//      blocking the ones under it.
//   4. Not knowing yet. Contacts and prospects load separately, and an
//      empty contact list would otherwise print the whole book as unmapped.
import {
  accountHasDecisionMaker,
  decisionMakerCompanies,
  decisionMakerCoverage,
  isDecisionMakerContact,
  tierAccounts,
} from '../src/utils/decisionMakerCoverage.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const CDM = 'Dan Baldauf';
const acct = (company, tier, over = {}) => ({
  id: company.toLowerCase().replace(/\s+/g, '-'), company, tier, cdm: 'Dan Baldauf', ...over,
});
const contact = (company, tags, over = {}) => ({
  id: `${company}-${tags}`.toLowerCase(), company, dans_tags: tags, ...over,
});
const tierOf = (cov, tier) => cov.tiers.find(t => t.tier === tier);
const names = (rows) => rows.map(r => r.company);

// --- who counts as a decision maker -------------------------------------
check('tagged Decision Maker counts',
  isDecisionMakerContact(contact('Acme', 'Decision Maker')), true);
check('the tag is read case-insensitively, alongside others',
  isDecisionMakerContact(contact('Acme', 'Key Contact;decision maker')), true);
check('an untagged contact does not',
  isDecisionMakerContact(contact('Acme', 'Key Contact')), false);
check('nor does a hidden one',
  isDecisionMakerContact(contact('Acme', 'Decision Maker;Hide')), false);
check('nor one who has left — the row would clear on somebody who is gone',
  isDecisionMakerContact(contact('Acme', 'Decision Maker;Left')), false);
check('nor a Schneider contact, who is off every other roster too',
  isDecisionMakerContact(contact('Schneider Electric', 'Decision Maker')), false);
check('a Schneider contact is caught by email domain as well as company',
  isDecisionMakerContact({ company: 'SE', dans_tags: 'Decision Maker', email: 'x@se.com' }), false);

// --- attaching one to an account ----------------------------------------
{
  const dms = decisionMakerCompanies([
    contact('Acme Corporation', 'Decision Maker'),
    contact('Acme Corporation', 'Decision Maker'),
    contact('', 'Decision Maker'),
    contact('Northwind', 'Key Contact'),
  ]);
  check('one company per name, however many decision makers are on it',
    dms.map(d => d.company), ['Acme Corporation']);
  check('an exact name matches', accountHasDecisionMaker(acct('Acme Corporation', 'Tier 1'), dms), true);
  check('so does a company spelled differently on the contact',
    accountHasDecisionMaker(acct('Acme Corp', 'Tier 1'), dms), true);
  check('an unrelated account does not',
    accountHasDecisionMaker(acct('Northwind', 'Tier 1'), dms), false);
  check('and neither does an account with no name',
    accountHasDecisionMaker(acct('', 'Tier 1'), dms), false);
}

// --- a hand-corrected company is the one that counts ---------------------
{
  const raw = { id: 'c1', company: 'Acme Holdings GmbH', dans_tags: 'Decision Maker' };
  const dms = decisionMakerCompanies([raw], { c1: { _companyOverride: 'Northwind Energy' } });
  check('the override decides which account the contact belongs to',
    dms.map(d => d.company), ['Northwind Energy']);
}

// --- which accounts the percentage is over ------------------------------
{
  const prospects = [
    acct('Alpha', 'Tier 1'),
    acct('Beta', 'tier 1'),
    acct('Gamma', 'Tier 1', { status: 'Client' }),
    acct('Delta', 'Tier 1', { cdm: 'Someone Else' }),
    acct('Epsilon', 'Tier 2'),
  ];
  check('this CDM\'s Tier 1 accounts, clients out, tier read case-insensitively',
    names(tierAccounts(prospects, CDM, 'Tier 1')), ['Alpha', 'Beta']);
}

// --- the tiers, worked one at a time ------------------------------------
{
  const prospects = [
    acct('Alpha', 'Tier 1'),
    acct('Beta', 'Tier 1'),
    acct('Gamma', 'Tier 2'),
    acct('Delta', 'Tier 3'),
  ];
  const contacts = [contact('Alpha', 'Decision Maker'), contact('Beta', 'Key Contact')];
  const cov = decisionMakerCoverage({ prospects, contacts, cdmName: CDM });

  check('Tier 1 reports mapped, missing and a percentage',
    [tierOf(cov, 'Tier 1').total, tierOf(cov, 'Tier 1').mapped, tierOf(cov, 'Tier 1').pct], [2, 1, 50]);
  check('the tier being worked is the first one with anything left',
    cov.focusTier, 'Tier 1');
  check('and it is the only tier handing over rows',
    names(tierOf(cov, 'Tier 1').missing), ['Beta']);
  check('the tiers behind it still report their own numbers',
    [tierOf(cov, 'Tier 2').pct, tierOf(cov, 'Tier 3').pct], [0, 0]);
  check('every unmapped account is counted, not only the tier on show',
    cov.missingTotal, 3);
  check('a book with anything left is not all mapped', cov.allMapped, false);

  // Beta gets its decision maker: Tier 1 is finished, so Tier 2 is next.
  const cov2 = decisionMakerCoverage({
    prospects,
    contacts: [...contacts, contact('Beta', 'Decision Maker')],
    cdmName: CDM,
  });
  check('a finished Tier 1 reads 100%', tierOf(cov2, 'Tier 1').pct, 100);
  check('and hands the list to Tier 2', cov2.focusTier, 'Tier 2');
  check('whose accounts are now the ones listed',
    names(tierOf(cov2, 'Tier 2').missing), ['Gamma']);

  // Tier 2 done too: Tier 3, and then nothing.
  const cov3 = decisionMakerCoverage({
    prospects,
    contacts: [...contacts, contact('Beta', 'Decision Maker'), contact('Gamma', 'Decision Maker')],
    cdmName: CDM,
  });
  check('then Tier 3', cov3.focusTier, 'Tier 3');
  const cov4 = decisionMakerCoverage({
    prospects,
    contacts: [...contacts, contact('Beta', 'Decision Maker'), contact('Gamma', 'Decision Maker'), contact('Delta', 'Decision Maker')],
    cdmName: CDM,
  });
  check('and then there is no tier to work', cov4.focusTier, '');
  check('which is what all-mapped means', [cov4.allMapped, cov4.missingTotal], [true, 0]);
}

// --- an empty tier doesn't block the ones under it ----------------------
{
  const prospects = [acct('Gamma', 'Tier 2')];
  const cov = decisionMakerCoverage({ prospects, contacts: [], cdmName: CDM });
  check('no Tier 1 accounts means Tier 2 is the work',
    [cov.focusTier, tierOf(cov, 'Tier 1').total, tierOf(cov, 'Tier 1').pct], ['Tier 2', 0, null]);
}

// --- the percentage never rounds past the rows underneath it ------------
{
  const prospects = Array.from({ length: 200 }, (_, i) => acct(`Co ${String(i).padStart(3, '0')}`, 'Tier 1'));
  // 199 of 200 mapped is 99.5%, which rounds to 100 — and a tier reading
  // 100% with a row still listed under it is the one thing this table
  // must never say.
  const contacts = prospects.slice(1).map(p => contact(p.company, 'Decision Maker'));
  const cov = decisionMakerCoverage({ prospects, contacts, cdmName: CDM });
  check('199 of 200 reads 99%, not 100', tierOf(cov, 'Tier 1').pct, 99);
  check('with the one account still listed', names(tierOf(cov, 'Tier 1').missing), ['Co 000']);
}

// --- how many contacts are already at the account -----------------------
{
  const prospects = [acct('Alpha', 'Tier 1'), acct('Beta', 'Tier 1')];
  const contacts = [
    contact('Alpha', 'Key Contact'),
    contact('Alpha Inc', 'Key Contact'),
    contact('Alpha', 'Hide'),
  ];
  const missing = tierOf(decisionMakerCoverage({ prospects, contacts, cdmName: CDM }), 'Tier 1').missing;
  check('an account with contacts but no tag says how many there are to tag',
    missing.map(r => [r.company, r.contactCount]), [['Alpha', 2], ['Beta', 0]]);
}

// --- not knowing yet ----------------------------------------------------
check('no contacts yet is null, not a book of unmapped accounts',
  decisionMakerCoverage({ prospects: [acct('Alpha', 'Tier 1')], contacts: null, cdmName: CDM }), null);
check('and neither are prospects that haven\'t loaded',
  decisionMakerCoverage({ prospects: null, contacts: [], cdmName: CDM }), null);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
