import { createRoot } from 'react-dom/client';
import { DecisionMakerTagsTable } from './src/components/MyAccountsView/DecisionMakerTagsTable';
const accounts = [
  { id: '1', company: 'Prologis', myTier: 'Tier 1', status: 'Client' },
  { id: '2', company: 'Ventas', myTier: 'Tier 1' },
  { id: '3', company: 'Hines', myTier: 'Tier 2' },
  { id: '4', company: 'Macerich', myTier: 'Tier 3' },
];
const contacts = [
  { id: 'a', firstname: 'Ann', lastname: 'Lee', company: 'Prologis', jobtitle: 'VP ESG', dans_tags: 'Decision Maker;ESG' },
  { id: 'b', firstname: 'Bob', lastname: 'Ray', company: 'Prologis', dans_tags: 'Decision Maker;Procurement;ESG' },
  { id: 'c', firstname: 'Cy', lastname: 'Hu', company: 'Ventas', dans_tags: 'ESG' },
  { id: 'd', firstname: 'Di', lastname: 'Fox', company: 'Hines', dans_tags: 'Decision Maker;Capital Planning' },
  { id: 'e', firstname: 'Ed', lastname: 'Po', company: 'Macerich', dans_tags: 'Decision Maker;Hide;ESG' },
];
createRoot(document.getElementById('root')).render(
  <DecisionMakerTagsTable accounts={accounts} contacts={contacts} settings={{}} updateSettings={() => {}} onSelect={r => console.log('select', r.company)} />
);
