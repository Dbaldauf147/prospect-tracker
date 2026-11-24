// The statuses a service can be set to (the editable list, see
// utils/serviceStatusList.js), for any dropdown that offers them. Re-renders
// when the list is edited.
import { useSyncExternalStore } from 'react';
import { currentServiceStatuses, subscribeServiceStatuses } from '../utils/serviceStatusList';

export function useServiceStatuses() {
  return useSyncExternalStore(subscribeServiceStatuses, currentServiceStatuses, currentServiceStatuses);
}
