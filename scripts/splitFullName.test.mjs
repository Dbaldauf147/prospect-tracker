// Splitting a pasted whole name into the contact form's two boxes.
// Plain Node, no test framework (the project has none). Run:
//   node scripts/splitFullName.test.mjs
//
// This is a guess about a person's name, and people are particular about
// their names. The form only ever OFFERS what comes out of here, but an
// offer that is wrong often enough stops being read, so the cases below are
// the ones worth being right about.
//
// Four ways it goes wrong:
//
//   1. Reading a comma the wrong way round. "Chen, Sarah" is a directory
//      listing and "Sarah Chen, CPA" is a signature, and getting them
//      confused files somebody under "CPA".
//
//   2. Cutting a surname in half. "Van Der Berg" is one name in three
//      words, and this has to draw that line in the same place
//      nameFromEmail draws it for van.der.berg@ - the same person pasted
//      two ways has to come out the same.
//
//   3. Keeping what is not a name. A PhD is something somebody has, not
//      something they are called; a Jr. is part of what they are called.
//
//   4. Guessing at something that is not a name at all. An email address or
//      a phone number pasted into the box has to produce nothing rather
//      than junk in the two fields that matter most.
import { splitFullName } from '../src/utils/splitFullName.js';
import { nameFromEmail } from '../src/utils/nameFromEmail.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}
// Split and print as "first|last" so a mis-split reads at a glance.
const split = (s) => {
  const r = splitFullName(s);
  return r === null ? 'null' : `${r.firstname}|${r.lastname}`;
};

// ---- the ordinary case ---------------------------------------------------
check('two words split into two names', split('Sarah Chen'), 'Sarah|Chen');
check('spacing does not matter', split('  Sarah   Chen '), 'Sarah|Chen');
check('a middle name has nowhere to go, so it goes nowhere',
  split('Mary Anne Smith'), 'Mary|Smith');
check('nor does a middle initial', split('John Q. Public'), 'John|Public');

// ---- one word ------------------------------------------------------------
// A surname invented from nothing is how a contact ends up filed under half
// of their own name.
check('a single word is a first name, not a surname', split('Cher'), 'Cher|');
check('and a half-typed one still offers what is there', split('Sarah'), 'Sarah|');

// ---- the comma, both ways round -----------------------------------------
check('surname first is turned back round', split('Chen, Sarah'), 'Sarah|Chen');
check('with a middle name too', split('Smith, Mary Anne'), 'Mary|Smith');
check('letters after the name are not the name',
  split('Sarah Chen, CPA'), 'Sarah|Chen');
check('however many of them there are',
  split('Sarah Chen, CPA, MBA'), 'Sarah|Chen');
// The hard one: the tail decides which kind of comma it is, and "Chen" is
// not a credential.
check('a surname is not mistaken for a credential', split('Chen, Robert'), 'Robert|Chen');

// ---- titles and suffixes -------------------------------------------------
check('a title is not a first name', split('Dr. Amelia Rodriguez'), 'Amelia|Rodriguez');
check('nor is it when it has no full stop', split('Prof Amelia Rodriguez'), 'Amelia|Rodriguez');
check('two of them still leave the name', split('Dr. Mrs. Amelia Rodriguez'), 'Amelia|Rodriguez');
// A qualification is something you have; a generational suffix is something
// you are called.
check('a credential is dropped', split('John Smith PhD'), 'John|Smith');
check('however it is punctuated', split('John Smith, Ph.D.'), 'John|Smith');
check('a generational suffix is kept', split('John Smith Jr.'), 'John|Smith Jr.');
check('including a roman one', split('John Smith III'), 'John|Smith III');
check('and it rides through a reversed name', split('Smith, John Jr.'), 'John|Smith Jr.');
// "V" after a name is an initial far more often than it is a fifth.
check('a lone V is left alone as a surname', split('John V'), 'John|V');

// ---- surnames that are more than one word -------------------------------
check('a particle takes the words behind it',
  split('Mary Van Der Berg'), 'Mary|Van Der Berg');
check('a lowercase particle too', split('Vincent van Gogh'), 'Vincent|van Gogh');
check('and one with a middle name in front of it',
  split('Mary Anne de la Cruz'), 'Mary|de la Cruz');

// The same person, pasted two ways. A form that split them differently
// depending on which box they landed in would be a form that disagrees with
// itself, so this is pinned rather than left to two implementations.
{
  const pasted = splitFullName('Mary Van Der Berg');
  const typed = nameFromEmail('mary.van.der.berg@acme.com');
  check('a pasted name and the same address agree on the surname',
    pasted.lastname.toLowerCase(), typed.lastname.toLowerCase());
  check('and on the first name',
    pasted.firstname.toLowerCase(), typed.firstname.toLowerCase());
}

// ---- casing --------------------------------------------------------------
// A signature in block capitals is not somebody shouting their name.
check('a shouted name is re-cased', split('SARAH CHEN'), 'Sarah|Chen');
check('across the punctuation inside it', split("SARAH O'BRIEN"), "Sarah|O'Brien");
// Everything else was cased by a human, and a blanket re-casing would break
// every one of these.
check('McDonald keeps its capital', split('Ronald McDonald'), 'Ronald|McDonald');
check('so does DeSantis', split('Ron DeSantis'), 'Ron|DeSantis');
check('and a deliberately lowercase name', split('bell hooks'), 'bell|hooks');

// ---- not a name ----------------------------------------------------------
check('nothing in, nothing out', split(''), 'null');
check('whitespace is nothing', split('   '), 'null');
check('null is nothing', split(null), 'null');
check('an address is not a name', split('sarah.chen@acme.com'), 'null');
check('nor is a phone number', split('+1 502 555 0134'), 'null');
check('nor a row with a number in it', split('Sarah Chen 42'), 'null');
check('punctuation alone is not a name', split('---'), 'null');
// A title is only stripped when there is a name behind it. On its own it is
// the only word there is, and dropping it would erase real surnames on the
// way past - Fr, Dame and Miss are all somebody's name somewhere.
check('a title on its own is left as the word it is', split('Dr.'), 'Dr.|');

console.log(`\n${failures ? `${failures} FAILED` : 'All passed'}`);
process.exit(failures ? 1 : 0);
