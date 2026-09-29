import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ServicesTab } from './src/components/PricingView/ServicesTab.jsx';
import { rateCardCheck } from './src/utils/serviceRateCheck.js';
const entry = { basis: 'recurring_annual', rate: 42000, rateHigh: 84000, lines: [{ basis: 'per_account', rate: 32, rateHigh: 46 }] };
const base = [
  { id: 'a', description: 'Setup work', type: 'Setup', cts: 2909.5, startMonth: 1, unit: '', otherServices: [] },
  { id: 'b', description: 'Analyst time', type: 'Recurring (monthly)', cts: 200, startMonth: 1, unit: '', otherServices: [] },
  { id: 'c', description: 'Per-account data', type: 'Recurring (monthly)', cts: 81.9, startMonth: 1, unit: '', otherServices: [] },
];
function App() {
  const [picks, setPicks] = useState(window.__picks || {});
  const workbook = { options: [{ optionNumber: 1, sheetName: 'Option 1', sections: [] }] };
  const detailFor = () => {
    const items = base.map(it => ({ ...it, feeComponent: picks[it.id] || null }));
    const rateCheck = rateCardCheck({ items, entry, meta: { serviceType: 'Recurring', years: '3 years' }, counts: { accounts: 519 }, techDeprPct: 0.04 });
    return { items, fees: [], rateCheck, counts: {}, enteredCounts: {}, fromSia: { accounts: 519 }, sia: { accounts: 519 } };
  };
  return <ServicesTab workbook={workbook} activeOption={1} setActiveOption={() => {}}
    services={[{ name: 'Utility Bill Mgmt', inScope: true, status: 'Active', meta: {} }]}
    detailFor={detailFor} onIgnoreForCheck={() => {}} onSetCount={() => {}}
    onSetFeeComponent={(svc, id, c) => setPicks(p => ({ ...p, [id]: c }))} />;
}
createRoot(document.getElementById('root')).render(<App />);
