// Which months' commission files have been uploaded on Commissions > Monthly.
//
// Held in user settings as `commissionMonthUploads`, keyed 'YYYY-MM', so it
// syncs to Dan's other machine:
//   { '2026-10': { fileName: 'Oct commissions.xlsx', at: '2026-11-02T14:05:00.000Z' } }
//
// A card stands for the most recent occurrence of its month: in November
// 2026, January-November are 2026 and December is December 2025. A month
// card turns green once its file has been imported, and the Issues tab
// warns while last month's file is still missing.

// Same order as COMMISSION_MONTH_NAMES in commissionsStore.js; repeated
// here so the Issues detectors don't pull in that store's mirror sync.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const COMMISSION_UPLOADS_KEY = 'commissionMonthUploads';

function pad2(n) { return String(n).padStart(2, '0'); }

// 'YYYY-MM' for the most recent occurrence of month `monthIdx` (0-11),
// counting the current month as this year's.
export function commissionUploadKey(monthIdx, now = new Date()) {
  const year = now.getFullYear() - (monthIdx > now.getMonth() ? 1 : 0);
  return `${year}-${pad2(monthIdx + 1)}`;
}

export function commissionUploadFor(uploads, monthIdx, now = new Date()) {
  const entry = uploads && typeof uploads === 'object' ? uploads[commissionUploadKey(monthIdx, now)] : null;
  return entry && typeof entry === 'object' ? entry : null;
}

// Settings patch that records a file as uploaded for `monthIdx`.
export function recordCommissionUpload(uploads, monthIdx, fileName, now = new Date()) {
  const base = uploads && typeof uploads === 'object' ? uploads : {};
  return {
    ...base,
    [commissionUploadKey(monthIdx, now)]: { fileName: String(fileName || ''), at: now.toISOString() },
  };
}

// The Issues-tab row for last month's file, while it hasn't been uploaded.
// Keyed by month, so snoozing October's warning doesn't hide November's.
export function missingCommissionFileIssues(uploads, now = new Date()) {
  const lastIdx = (now.getMonth() + 11) % 12;
  if (commissionUploadFor(uploads, lastIdx, now)) return [];
  const key = commissionUploadKey(lastIdx, now);
  const month = MONTH_NAMES[lastIdx];
  const year = key.slice(0, 4);
  return [{
    id: `commission-file-missing:${key}`,
    source: 'Commissions',
    type: 'Commission file not uploaded',
    company: '-',
    oppNumber: null,
    prospectId: null,
    daysUntil: null,
    expirationDate: null,
    detail: `The ${month} ${year} commissions file hasn't been uploaded yet. `
      + `Drop it on the ${month} card under Clients > Commissions > Monthly.`,
  }];
}
