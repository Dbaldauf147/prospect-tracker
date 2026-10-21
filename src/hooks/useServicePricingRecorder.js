// Records Dropdowns > Service Pricing History's reading once a day from App,
// so a day is logged whenever the app is open rather than only when that
// subtab is (utils/servicePricingHistory.js). Only once settings have
// loaded: before then the card reads as the built-in defaults and the day
// would log a dip. Waits a few seconds after settings settle so a burst of
// edits writes once.

import { useEffect } from 'react';
import { recordServicePricing, servicePricingCoverage } from '../utils/servicePricingHistory';
import { todayISO } from '../utils/prospectingStatus';

export function useServicePricingRecorder({ settings, settingsLoaded, userId }) {
  useEffect(() => {
    if (!userId || !settingsLoaded) return undefined;
    const t = setTimeout(() => {
      try { recordServicePricing(todayISO(), servicePricingCoverage(settings)); } catch { /* a bad reading is skipped, not fatal */ }
    }, 5000);
    return () => clearTimeout(t);
  }, [userId, settingsLoaded, settings]);
}
