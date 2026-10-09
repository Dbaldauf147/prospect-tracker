// Assertion tests for the "already open in another tab" check.
//   node scripts/tabPresence.test.mjs
import { watchEarlierTabs } from '../src/utils/tabPresence.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// A BroadcastChannel stand-in: a message reaches every OTHER open channel,
// synchronously, so the assertions don't need to wait.
function bus() {
  const open = new Set();
  return () => {
    const ch = {
      onmessage: null,
      postMessage(data) { for (const o of open) if (o !== ch && o.onmessage) o.onmessage({ data }); },
      close() { open.delete(ch); },
    };
    open.add(ch);
    return ch;
  };
}

{
  const make = bus();
  const seen = { a: [], b: [], c: [] };
  const stopA = watchEarlierTabs(n => seen.a.push(n), { channel: make(), id: 'a' });
  check('a lone tab hears nothing', seen.a, []);
  const stopB = watchEarlierTabs(n => seen.b.push(n), { channel: make(), id: 'b' });
  check('the second tab learns of the first', seen.b, [1]);
  check('the first tab is never warned', seen.a, []);
  watchEarlierTabs(n => seen.c.push(n), { channel: make(), id: 'c' });
  check('a third tab counts both', seen.c, [1, 2]);
  stopA();
  check('closing the first tab is reported', [seen.b.at(-1), seen.c.at(-1)], [0, 1]);
  stopB();
  check('and the second', seen.c.at(-1), 0);
  stopB();
  check('stop twice is harmless', seen.c.at(-1), 0);
}

check('no BroadcastChannel, no-op', typeof watchEarlierTabs(() => {}, { channel: null }), 'function');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
