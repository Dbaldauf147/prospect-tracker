// House rule: no em dash (—, U+2014) in anything the site shows.
//
// Not a style preference the linter can be talked out of — it is a rule
// about the product's voice, so it is enforced the only way a rule holds
// in a codebase this size: a test that fails.
//
// WHAT IS CHECKED: every character of src/ and api/ that is not inside a
// comment. That is the text the app renders and the mail it sends —
// string literals, template literals, JSX text — plus anything that ends
// up in one, which is why this scans the source rather than a build.
//
// WHAT IS NOT: comments. They are notes between the people working on
// this, never shown to anybody using it, and the house style leans on the
// dash heavily. Rewriting six thousand comment lines would bury the
// history of every file to change nothing a user can see.
//
// THE ESCAPE HATCH: a line carrying `em-dash-ok` in a trailing comment is
// allowed to keep the character. Every one of them is the same thing:
// code that READS an em dash out of text somebody else wrote — a news
// headline, a pasted spreadsheet cell — where the character is data, not
// voice. Reach for it only for that.
//
// Run:
//   node scripts/noEmDash.test.mjs
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

// Every way an em dash can reach a screen from this source: the character
// itself, the JS escape for it, and the three HTML entities. All five
// render identically in a browser and in a mail client, and checking
// only the character is how sixteen `&mdash;` survived the first sweep.
const FORMS = /\\u2014|&mdash;|&#8212;|&#x2014;|\u2014/gi;
const ALLOW = 'em-dash-ok';

/**
 * For each character of a JS/JSX source, is it inside a comment?
 *
 * Hand-rolled because the project has no parser dependency and this needs
 * to be exact in one direction: a string that merely LOOKS like a comment
 * ("https://x" carries a //) must not be masked, or the rule quietly
 * stops covering every URL-bearing line in the app.
 */
export function commentMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  let quote = null;      // the ' " or ` we are inside, if any
  const tmpl = [];       // ${ } nesting back out to code inside a template
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) { quote = null; i += 1; continue; }
      if (quote === '`' && c === '$' && d === '{') { tmpl.push('`'); quote = null; i += 2; continue; }
      i += 1;
      continue;
    }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { mask[i] = 1; i += 1; } continue; }
    if (c === '/' && d === '*') {
      const start = i;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i = Math.min(n, i + 2);
      for (let k = start; k < i; k += 1) mask[k] = 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; i += 1; continue; }
    if (c === '}' && tmpl.length) { tmpl.pop(); quote = '`'; i += 1; continue; }
    i += 1;
  }
  return mask;
}

/** Every line of `src` carrying an em dash, in any form, outside a comment. */
export function emDashLines(src) {
  FORMS.lastIndex = 0;
  if (!FORMS.test(src)) return [];
  const mask = commentMask(src);
  const lines = src.split('\n');
  const out = [];
  let pos = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes(ALLOW)) {
      let m;
      FORMS.lastIndex = 0;
      while ((m = FORMS.exec(line))) {
        if (!mask[pos + m.index]) { out.push({ line: i + 1, text: line.trim() }); break; }
      }
    }
    pos += line.length + 1;
  }
  return out;
}

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

// ---- the masker, on the cases that would silently hole the rule --------
check('a line comment is a comment', emDashLines('// a — b\n').length, 0);
check('a block comment is too', emDashLines('/* a\n * b —\n */\n').length, 0);
check('a string is not', emDashLines('const s = "a — b";\n').length, 1);
check('a template literal is not', emDashLines('const s = `a — b`;\n').length, 1);
check('nor the code inside one', emDashLines('const s = `x ${a === "—" ? 1 : 2}`;\n').length, 1);
check('JSX text is not', emDashLines('const a = <div>a — b</div>;\n').length, 1);
// The one that matters: a // inside a string is not the start of a comment.
check('a URL in a string does not mask the rest of the line',
  emDashLines('const u = "https://x.test"; const s = "a — b";\n').length, 1);
check('an apostrophe inside a comment does not open a string',
  emDashLines("// don't\nconst s = 'a — b';\n").length, 1);
check('an escaped quote does not end a string early',
  emDashLines('const s = "a \\" — b";\n').length, 1);
// The forms that are not the character but land on screen as one.
check('the JS escape counts', emDashLines('const s = "a \\\\u2014 b";\n').length, 1);
check('the &mdash; entity counts', emDashLines('const a = <p>a &mdash; b</p>;\n').length, 1);
check('the numeric entity counts', emDashLines('const a = <p>a &#8212; b</p>;\n').length, 1);
check('the hex entity counts', emDashLines('const a = <p>a &#x2014; b</p>;\n').length, 1);
check('an en dash is left alone', emDashLines('const s = "$3 \u2013 $4";\n').length, 0);

check('the escape hatch spares a line', emDashLines('const s = "—"; // em-dash-ok: parses\n').length, 0);
check('and only that line',
  emDashLines('const a = "—"; // em-dash-ok\nconst b = "—";\n').length, 1);

// ---- the rule ----------------------------------------------------------
const files = execSync("git ls-files 'src/**/*.js' 'src/**/*.jsx' 'api/**/*.js'", { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);

const offenders = [];
for (const file of files) {
  for (const hit of emDashLines(readFileSync(file, 'utf8'))) {
    offenders.push(`${file}:${hit.line}  ${hit.text.slice(0, 120)}`);
  }
}

check('no em dash reaches the screen', offenders.length, 0);
if (offenders.length) {
  console.log('\nUse a hyphen, a comma, or two sentences. If the character is');
  console.log('being read out of somebody else\'s text rather than shown, mark the');
  console.log('line `// em-dash-ok: <why>`.\n');
  console.log(offenders.slice(0, 40).join('\n'));
  if (offenders.length > 40) console.log(`… and ${offenders.length - 40} more`);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
