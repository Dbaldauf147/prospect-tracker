// One company's All Missing Steps, the number the Company Data subtab shows
// per row and the All Missing History subtab charts summed across them:
// the steps left on its Contacts > By Category ladder (utils/dmSteps), plus
// one for each of Sites, Utility Accounts and Equipment left blank.
//
// Pure, so both readers count the same way: scripts/allMissingSteps.test.mjs.

import { COMPANY_DATA_FIELDS, fieldHasValue } from './companyDataFields.js';
import { companyStepsRemaining } from './dmSteps.js';

// The size numbers that each count as a step of their own.
export const STEP_FIELDS = COMPANY_DATA_FIELDS.filter(f => ['numberOfSites', 'numberOfAccounts', 'equipmentCount'].includes(f.key));

/**
 * { stepsRemaining, perBucket, allDms, missingData, missingDataFields, allMissingSteps }
 * for one company record. `dms` is its decision makers (the shared
 * decision-maker lookup's forAccount), `titleSearches` its logged Zoom
 * title searches (titleSearchesForCompany), `closedBuckets` the categories
 * its services close out (bucketServices.companyClosedBuckets).
 */
export function allMissingStepsFor({ record = {}, dms = [], tagReview = null, titleSearches = [], closedBuckets = null } = {}) {
  const steps = companyStepsRemaining({ dms, record, tagReview, titleSearches, closedBuckets });
  const missingDataFields = STEP_FIELDS.filter(f => !fieldHasValue(f, record?.[f.key]));
  return {
    stepsRemaining: steps.total,
    perBucket: steps.perBucket,
    allDms: steps.allDms,
    missingData: missingDataFields.length,
    missingDataFields,
    allMissingSteps: steps.total + missingDataFields.length,
  };
}
