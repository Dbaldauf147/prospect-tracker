import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './src/index.css';
import { ServicesTab } from './src/components/PricingView/ServicesTab';
const services = ['BBS reporting','Bill payment','Budgets','Water Cost Recovery'].map((n,i)=>({ name:n, bucket:'DATA', status:'Active', inScope:true, meta:null })).concat([{ name:'Other', bucket:'', status:'Retired', inScope:false }]);
function App() {
  const [wb, setWb] = useState({ options: [{ optionNumber: 1, sheetName: 'Option 1', sections: [], servicesCompleted: ['bbs reporting'] }] });
  return <div style={{ display:'flex', height:'100vh' }}><ServicesTab workbook={wb} activeOption={1} setActiveOption={()=>{}} services={services}
    detailFor={() => ({ items: [], fees: [], rateCheck: null, counts: {}, enteredCounts: {}, fromSia: {}, sia: {} })}
    onSetCompleted={(name,on)=>setWb(p=>{const d=new Set(p.options[0].servicesCompleted); const k=name.toLowerCase(); on?d.add(k):d.delete(k); return {options:[{...p.options[0], servicesCompleted:[...d]}]};})} /></div>;
}
createRoot(document.getElementById('root')).render(<App />);
