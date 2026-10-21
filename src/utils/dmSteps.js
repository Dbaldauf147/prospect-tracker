// The By Category ladder: for each contact category (the BUCKETS the org
// chart groups people into), how many steps are left before it is either
// mapped to a decision maker or closed out.
//
// One rule, read in two places: the company popup's Contacts > By Category
// table (the Steps remaining column beside the ladder) and My Accounts >
// Company Data (a Steps remaining column per company). Kept here so the two
// can't count differently. Pure, so it is pinned by
// scripts/dmSteps.test.mjs.

import { BUCKETS, contactHasTag } from '../components/ProspectModal/contactTags.js';
import { findTagRecord, tagKey, tagStateFrom } from './contactTagReview.js';

// The steps a category with no Yes decision maker is worked through, in
// order. 'zoom' is the original Search run tick and still reads and writes
// the record's dmSearchRun, so ticks made before the ladder existed carry
// over; the rest live in dmSearchSteps, keyed by bucket then step.
// 'zoomFailed' kept its key when it became "Zoom search ran", so old ticks
// still count; it is also done, tick or not, once a Zoom title search is
// logged for that category (Bulk Add > Zoom Search Log). Likewise 'manual'
// and 'manualFailed' kept their keys when they became Google search and
// LinkedIn search.
export const DM_STEPS = [
  { key: 'zoom',         label: 'No DM, but company Zoom ID' },
  { key: 'zoomFailed',   label: 'Zoom search ran' },
  { key: 'manual',       label: 'Google search' },
  { key: 'manualFailed', label: 'LinkedIn search' },
  { key: 'closeOut',     label: 'Close out' },
];

// How a decision maker stands on one category, read the way the contact
// popup reads it: 'yes' when they carry the category's tag (a Yes held off
// by a Not sold still counts), 'unsure' for a Not sure answer, '' otherwise.
export function dmBucketAnswer(c, bucket, tagReview = null) {
  const cid = c?.id ?? c?.vid;
  const stored = cid == null ? undefined : findTagRecord(tagReview?.[cid], bucket.label);
  return tagStateFrom(contactHasTag(c, bucket.tag), stored).answer;
}

// Steps left for one category, read as how far down the ladder it has got:
// a Yes decision maker means nothing is left (0); otherwise the furthest
// step done says where it stands, so a category with no DM and nothing else
// has all five left, one with a Zoom Company ID (the company has one, or the
// tick is on) has four, and one closed out has none. `titleSearched` says a
// Zoom title search is logged for this category, which does the Zoom search
// ran step on its own. `servicesClosed` says every service tagged to this
// category is Not Sold or N/A at the company (utils/bucketServices), which
// closes the category out with nothing left to do.
export function bucketStepsLeft({ bucket, hasYesDm, zoomCompanyId = '', searchRun = null, searchSteps = null, titleSearched = false, servicesClosed = false }) {
  if (hasYesDm || servicesClosed) return 0;
  let reached = 0;
  DM_STEPS.forEach((step, i) => {
    const done = step.key === 'zoom'
      ? (!!String(zoomCompanyId || '').trim() || !!searchRun?.[bucket.key])
      : step.key === 'zoomFailed'
        ? (!!titleSearched || !!searchSteps?.[bucket.key]?.[step.key])
        : !!searchSteps?.[bucket.key]?.[step.key];
    if (done) reached = i + 1;
  });
  return DM_STEPS.length - reached;
}

// Every category for one company. `dms` is the company's decision makers
// (already gated on the Decision Maker tag); the company record supplies
// the Zoom Company ID and the ticks; `titleSearches` is the company's logged
// Zoom title searches ([{ tag }], from titleSearchesForCompany);
// `closedBuckets` the keys of the categories its services close out
// (companyClosedBuckets). Returns { total, max, perBucket:
// [{ bucket, left, hasYesDm, servicesClosed }], allDms } with the buckets A
// to Z; allDms is a Yes decision maker on every category (closed-out ones
// don't count).
export function companyStepsRemaining({ dms = [], record = {}, tagReview = null, titleSearches = [], closedBuckets = null } = {}) {
  const perBucket = [...BUCKETS]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((bucket) => {
      const hasYesDm = (dms || []).some(c => dmBucketAnswer(c, bucket, tagReview) === 'yes');
      const servicesClosed = !!closedBuckets?.has(bucket.key);
      return {
        bucket,
        hasYesDm,
        servicesClosed,
        left: bucketStepsLeft({
          bucket,
          hasYesDm,
          zoomCompanyId: record?.zoomCompanyId,
          searchRun: record?.dmSearchRun,
          searchSteps: record?.dmSearchSteps,
          titleSearched: (titleSearches || []).some(t => tagKey(t?.tag) === tagKey(bucket.label)),
          servicesClosed,
        }),
      };
    });
  return {
    allDms: perBucket.length > 0 && perBucket.every(b => b.hasYesDm),
    total: perBucket.reduce((sum, b) => sum + b.left, 0),
    max: perBucket.length * DM_STEPS.length,
    perBucket,
  };
}
