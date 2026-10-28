// Assertion tests for the shared per-column table filters.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/columnFilter.test.mjs
//
// What's worth pinning: a prefix beats a substring in the suggestion list, a
// blank box narrows nothing, several boxes narrow together rather than apart,
// and — the one that decides whether a table can lie to you — a filter on a
// column that has been hidden stops applying instead of quietly removing rows
// with nothing on screen to explain it.
import {
  suggestionMatches, cellMatches, collectSuggestions, rowMatchesFilters,
  activeFilterCount, clearFilter, filtersForColumns, BLANKS_FILTER, NON_BLANKS_FILTER,
  readPickFilter, pickFilterIsActive, pickFilterMatches, pickListOptions,
} from '../src/utils/columnFilter.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// --- the suggestion list -------------------------------------------------
const statuses = ['No Reply', 'Not Sent', 'Out of Office', 'Replied'];
check('an empty query offers the column', suggestionMatches(statuses, ''), statuses);
check('whitespace is an empty query', suggestionMatches(statuses, '   '), statuses);
check('prefixes lead', suggestionMatches(statuses, 'no'), ['No Reply', 'Not Sent']);
// "off" is inside "Out of Office" and starts nothing — it still has to match.
check('substrings follow', suggestionMatches(statuses, 'off'), ['Out of Office']);
check('prefix before substring', suggestionMatches(['Monthly Invoice', 'Invoice Check'], 'inv'),
  ['Invoice Check', 'Monthly Invoice']);
// Upper case typed, lower case stored — and both a prefix ("Replied") and a
// substring ("No Reply") answer to it, prefix first.
check('case is ignored', suggestionMatches(statuses, 'REPL'), ['Replied', 'No Reply']);
check('nothing matches', suggestionMatches(statuses, 'zzz'), []);
check('no values at all', suggestionMatches(undefined, 'a'), []);

// --- what a column offers -------------------------------------------------
check('deduped, sorted, blanks dropped',
  collectSuggestions(['Acme', 'globex', '', 'Acme', null, ' Globex ', 'Bre Hotels']),
  ['Acme', 'Bre Hotels', 'globex']);
check('the first spelling wins', collectSuggestions(['Warburg Pincus', 'WARBURG PINCUS']), ['Warburg Pincus']);
check('nothing in the column', collectSuggestions([]), []);

// --- one cell against one box ---------------------------------------------
check('a blank box passes everything', cellMatches('anything', ''), true);
check('a blank box passes a blank cell', cellMatches('', ''), true);
check('half a name narrows', cellMatches('eric.pan@warburgpincus.com', 'warburg'), true);
check('case is ignored here too', cellMatches('Replied', 'repl'), true);
check('a miss is a miss', cellMatches('Replied', 'bounce'), false);
// Asking for a value must never hand back the rows that have none.
check('a blank cell fails a set box', cellMatches('', 'acme'), false);
check('a missing cell fails a set box', cellMatches(undefined, 'acme'), false);

// --- asking for the empty cells --------------------------------------------
check('(Blanks) keeps an empty cell', cellMatches('', BLANKS_FILTER), true);
check('(Blanks) keeps a missing cell', cellMatches(undefined, BLANKS_FILTER), true);
check('(Blanks) keeps a whitespace-only cell', cellMatches('   ', BLANKS_FILTER), true);
check('(Blanks) drops a filled cell', cellMatches('Acme', BLANKS_FILTER), false);
check('(Non-blanks) keeps a filled cell', cellMatches('Acme', NON_BLANKS_FILTER), true);
check('(Non-blanks) drops an empty cell', cellMatches('', NON_BLANKS_FILTER), false);
check('typed in any case', cellMatches('', ' (blanks) '), true);
check('half typed is still text', cellMatches('', '(bla'), false);
check('a blank filter narrows with the others',
  rowMatchesFilters({ company: 'Acme', country: '' }, { company: 'acme', country: BLANKS_FILTER }), true);

// --- a row against the whole row of boxes ---------------------------------
const row = { email: 'eric.pan@warburgpincus.com', company: 'Warburg Pincus', status: 'No Reply' };
check('nothing set passes', rowMatchesFilters(row, {}), true);
check('one box that matches', rowMatchesFilters(row, { company: 'warburg' }), true);
check('boxes narrow together', rowMatchesFilters(row, { company: 'warburg', status: 'no' }), true);
check('one miss fails the row', rowMatchesFilters(row, { company: 'warburg', status: 'replied' }), false);
check('blank boxes are ignored', rowMatchesFilters(row, { company: '  ', status: 'no reply' }), true);
check('a box on a column the row lacks', rowMatchesFilters(row, { notes: 'anything' }), false);

// --- counting and clearing ------------------------------------------------
check('counts only what is set', activeFilterCount({ a: 'x', b: '', c: '  ', d: 'y' }), 2);
check('nothing set', activeFilterCount({}), 0);
check('clearing one', clearFilter({ a: 'x', b: 'y' }, 'a'), { b: 'y' });
check('clearing one already clear returns the same map', clearFilter({ b: 'y' }, 'a'), { b: 'y' });

// --- a filter on a column that is no longer shown -------------------------
// The failure this prevents: hide Company while filtering on it and the table
// keeps hiding rows with no box on screen to explain why.
check('a hidden column loses its filter',
  filtersForColumns({ company: 'acme', status: 'no' }, ['email', 'status']), { status: 'no' });
check('every column still shown', filtersForColumns({ status: 'no' }, ['email', 'status']), { status: 'no' });
check('no columns at all', filtersForColumns({ status: 'no' }, []), {});
check('nothing to drop returns the same object',
  (() => { const f = { status: 'no' }; return filtersForColumns(f, ['status']) === f; })(), true);

// --- the header pick list (DataTable) -------------------------------------
check('a bare array is the picks', readPickFilter(['Sold', ' ']), { picks: ['Sold'], draft: '' });
check('picks plus a draft', readPickFilter({ picks: ['A'], draft: ' we ' }), { picks: ['A'], draft: 'we' });
check('an old single string is one pick', readPickFilter('Sold'), { picks: ['Sold'], draft: '' });
check('nothing is nothing', readPickFilter(undefined), { picks: [], draft: '' });
check('empty is inactive', pickFilterIsActive([]), false);
check('a draft alone is active', pickFilterIsActive({ picks: [], draft: 'x' }), true);
check('empty filter passes', pickFilterMatches('anything', []), true);
// The reason ticks are exact: "Sold" must not keep "Not Sold".
check('a tick is exact', pickFilterMatches('Not Sold', ['Sold']), false);
check('a tick ignores case', pickFilterMatches('sold', ['Sold']), true);
check('any tick passes', pickFilterMatches('Lost', ['Sold', 'Lost']), true);
check('the search box is a substring', pickFilterMatches('Warburg Pincus', { picks: [], draft: 'pinc' }), true);
// Searching "a" to find Alpha and ticking it must show Alpha, not every "a".
check('a tick overrides the search', pickFilterMatches('Banana', { picks: ['Alpha'], draft: 'a' }), false);
check('the ticked row still passes mid-search', pickFilterMatches('Alpha', { picks: ['Alpha'], draft: 'zzz' }), true);
check('a search that matches nothing', pickFilterMatches('KKR', { picks: [], draft: 'warb' }), false);
check('(Blanks) ticked keeps blanks', pickFilterMatches('  ', [BLANKS_FILTER]), true);
check('(Blanks) ticked drops values', pickFilterMatches('x', [BLANKS_FILTER]), false);
check('(Non-blanks) ticked keeps values', pickFilterMatches('x', [NON_BLANKS_FILTER]), true);
check('(Blanks) alongside a value', pickFilterMatches('', ['Sold', BLANKS_FILTER]), true);
{
  const o = pickListOptions(['West', 'east', '', 'West', null, 'East']);
  check('options dedupe and sort', o.suggestions, ['east', 'West']);
  check('options count each value', [o.counts.get('west'), o.counts.get('east')], [2, 2]);
  check('options count the blanks', o.blanks, 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
