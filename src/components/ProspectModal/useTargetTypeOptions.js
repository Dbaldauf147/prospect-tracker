import { useEffect, useState } from 'react';
import { loadTargetTypeOptions, TARGET_TYPE_OPTIONS_EVENT } from '../../utils/targetTypeOptions';

// The list, kept fresh across every open cell and the other tab.
export function useTargetTypeOptions() {
  const [options, setOptions] = useState(loadTargetTypeOptions);
  useEffect(() => {
    const refresh = () => setOptions(loadTargetTypeOptions());
    window.addEventListener(TARGET_TYPE_OPTIONS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(TARGET_TYPE_OPTIONS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return options;
}
