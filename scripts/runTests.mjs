// Runs every scripts/*.test.mjs and reports one verdict.
//
// The tests are plain Node assertion scripts (the project has no test
// framework, deliberately — see any of them for the house style). Each is
// self-contained, prints its own PASS/FAIL lines and exits non-zero when
// something failed. Until this existed there was no way to run them all,
// so 91 test files only ran when somebody remembered to type the filename
// of the one they had just edited.
//
//   npm test              run everything
//   npm test -- --quiet   only show output for files that failed
//
// Each file runs in its own process: they share module state through
// imports, and one test mutating a module singleton must not decide
// whether the next one passes.

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const quiet = process.argv.includes('--quiet');

// Run one test file, capturing its output so a passing run can stay quiet.
function runOne(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, file)], {
      cwd: path.resolve(here, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (err) => resolve({ file, code: 1, out: String(err?.stack || err) }));
    child.on('close', (code) => resolve({ file, code: code ?? 1, out }));
  });
}

const files = (await readdir(here))
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

if (files.length === 0) {
  console.error('No scripts/*.test.mjs found — did this move?');
  process.exit(1);
}

// Sequential rather than parallel. These are fast (the whole suite is a
// few seconds), and interleaved output from 91 processes would make a
// failure much harder to read than it is worth.
const failures = [];
for (const file of files) {
  const result = await runOne(file);
  if (result.code === 0) {
    if (!quiet) console.log(`PASS  ${file}`);
  } else {
    failures.push(result);
    console.log(`FAIL  ${file}`);
  }
}

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`\n${'─'.repeat(60)}\n${f.file} (exit ${f.code})\n${'─'.repeat(60)}`);
    console.log(f.out.trimEnd());
  }
}

console.log(`\n${files.length - failures.length}/${files.length} test files passed`);
process.exit(failures.length > 0 ? 1 : 0);
