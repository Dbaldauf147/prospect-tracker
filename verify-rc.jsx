import { createRoot } from 'react-dom/client';
import './src/index.css';
import { ServicesTab } from './src/components/PricingView/ServicesTab';
import { rateCardCheck } from './src/utils/serviceRateCheck';
const meta = { serviceType: 'Recurring', years: '3 years', productLine: 'SUSUP' };
const services = [{ name: 'Invoice variance testing', bucket: 'DATA', status: 'Active', inScope: true, meta }];
const items = [{ id: 1, description: 'Invoice variance testing', type: 'Recurring', cts: 1200, startMonth: 1, feeName: 'IVT', automatedName: '', unit: 'Site', passThrough: false, otherServices: [] }];
const counts = { sites: 120, accounts: 400 };
const which = new URLSearchParams(location.search).get('e') || 'within';
const entry = { within: { basis: 'per_site', rate: 150, rateHigh: 250 }, below: { basis: 'per_site', rate: 300, rateHigh: 400 }, none: {} }[which];
const detailFor = () => ({ items, fees: [], counts, rateCheck: rateCardCheck({ items, entry, meta, counts }) });
const wb = { options: [{ optionNumber: 1, sheetName: 'Option 1', sections: [] }] };
function App() { return <ServicesTab workbook={wb} activeOption={1} setActiveOption={() => {}} services={services} detailFor={detailFor} numYears={3} />; }
createRoot(document.getElementById('root')).render(<App />);
