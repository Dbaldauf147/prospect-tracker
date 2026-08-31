// The day cells behind the shared date picker's calendar (components/
// common/DateCell).
//
// The grid is always six weeks — 42 cells — with the gaps at either end
// filled by the neighbouring months' days rather than left blank. Two
// things fall out of that. Picking the 1st or 2nd of next month (the
// common case for a follow-up date set late in a month) doesn't mean
// paging forward and back. And the popup keeps one height whether the
// month spans four rows or six, so it can't grow past the bottom of the
// screen after the flip-above check has already run.

// Days in month `m` of year `y`. Month can be out of range (-1, 12):
// Date normalizes it, which is what makes the neighbour lookups below
// work across a year boundary.
export function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

// {y, m} `delta` months from {y, m}, rolling the year over as needed.
export function shiftMonth(y, m, delta) {
  const d = new Date(y, m + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}

// 42 cells for the month grid, each { y, m, d, outside } — `outside`
// marks the days belonging to the previous or next month, which the
// picker draws muted but still lets you click.
export function buildMonthGrid(y, m) {
  const leading = new Date(y, m, 1).getDay();
  const total = daysInMonth(y, m);
  const prev = shiftMonth(y, m, -1);
  const next = shiftMonth(y, m, 1);
  const prevTotal = daysInMonth(prev.y, prev.m);
  const cells = [];
  for (let i = leading; i > 0; i--) {
    cells.push({ y: prev.y, m: prev.m, d: prevTotal - i + 1, outside: true });
  }
  for (let d = 1; d <= total; d++) {
    cells.push({ y, m, d, outside: false });
  }
  for (let d = 1; cells.length < 42; d++) {
    cells.push({ y: next.y, m: next.m, d, outside: true });
  }
  return cells;
}
