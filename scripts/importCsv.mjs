import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, writeBatch, doc, getDocs, deleteDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCJKpdDmJ2exu26lBmYWWOAfJ92cKvQ6Rg",
  authDomain: "tracker-3161a.firebaseapp.com",
  projectId: "tracker-3161a",
  storageBucket: "tracker-3161a.firebasestorage.app",
  messagingSenderId: "814639209412",
  appId: "1:814639209412:web:eb32e972b84fd213046291",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const VALID_FRAMEWORKS = new Set(['GRESB', 'CDP', 'UN PRI', 'SBT', 'NZAM']);
const VALID_STATUSES = new Set([
  'Client', 'Inside Sales', 'Qualifying', 'Hold Off',
  'Lost - Not Sold', 'Old Client', 'Partnering w/Another CDM',
]);

// Simple CSV parser that handles quoted fields with commas and newlines
function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { current.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field);
        field = '';
        if (ch === '\r') i++;
        rows.push(current);
        current = [];
      } else {
        field += ch;
      }
    }
  }
  if (field || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  return rows;
}

function parseNumber(val) {
  if (!val || val.trim() === '' || val === 'Missing Data') return null;
  const n = parseFloat(val.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function parseFrameworks(val) {
  if (!val) return [];
  return val.split(',').map(s => s.trim()).filter(f => VALID_FRAMEWORKS.has(f));
}

function parseAssetTypes(val) {
  if (!val) return [];
  return val.split(',').map(s => s.trim()).filter(Boolean).filter(s =>
    s !== 'Strategic Account' && s !== 'Largest' && s.length > 1
  );
}

async function main() {
  const csvPath = process.argv[2] || 'accounts.csv';
  console.log('Reading', csvPath, '...');
  const raw = readFileSync(csvPath, 'utf-8');
  const rows = parseCsv(raw);
  const headers = rows[0];
  console.log('Headers:', headers.length, 'columns');
  console.log('Data rows:', rows.length - 1);

  // Map header indices
  const idx = {};
  headers.forEach((h, i) => { const key = h.trim(); if (key && !(key in idx)) idx[key] = i; });

  const prospects = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const company = (row[idx['Company']] || '').trim();
    if (!company) continue;

    let status = (row[idx['Status']] || '').trim();
    const BAD_VALS = new Set(['TRUE', 'FALSE', '#N/A', '#REF!', '#VALUE!', '#NAME?']);
    if (BAD_VALS.has(status.toUpperCase())) {
      const colC = (row[2] || '').trim();
      status = BAD_VALS.has(colC.toUpperCase()) ? '' : colC;
    }
    const tier = (row[idx['Tier']] || '').trim();

    prospects.push({
      company,
      cdm: (row[idx['CDM']] || '').trim(),
      status: VALID_STATUSES.has(status) ? status : status || '',
      type: (row[idx['Type']] || '').trim(),
      geography: (row[idx['Geography']] || '').trim(),
      publicPrivate: (row[idx['Public/ Private']] || '').trim(),
      assetTypes: parseAssetTypes(row[idx['Asset Types']]),
      peAum: parseNumber(row[idx['PE AUM (billions)']]),
      reAum: parseNumber(row[idx['RE AUM (billions)']]),
      numberOfSites: parseNumber(row[idx['Number of Sites']]),
      rank: (row[idx['Rank']] || '').trim(),
      tier,
      hqRegion: (row[idx['HQ Region']] || '').trim(),
      frameworks: parseFrameworks(row[idx['Frameworks']]),
      notes: (row[idx['Notes']] || '').trim(),
      bfoCompanyId: (row[idx['BFO Company ID']] || '').trim(),
      bfoCompanyName: (row[idx['BFO Company Name']] || '').trim(),
      zoomCompanyId: (row[idx['Zoom Company ID']] || '').trim(),
      zoomCompanyName: (row[idx['Zoom Company Name']] || '').trim(),
      website: (row[idx['Zoom Webiste']] || '').trim(),
      emailDomain: (row[idx['Email Domain']] || '').trim(),
      contacts: parseNumber(row[idx['Contacts']]),
      contactTypes: (row[idx['Contact Types']] || '').trim(),
      salesperson: (row[idx['Salesperson Tiered List']] || '').trim(),
      peOrRe: (row[idx['PE OR RE']] || '').trim(),
      tierList: (row[idx['Tier List']] || '').trim(),
    });
  }

  console.log('Parsed', prospects.length, 'prospects');

  // Clear existing prospects
  console.log('Clearing existing prospects...');
  const existing = await getDocs(collection(db, 'prospects'));
  let deleteCount = 0;
  for (const d of existing.docs) {
    await deleteDoc(d.ref);
    deleteCount++;
    if (deleteCount % 100 === 0) console.log('  Deleted', deleteCount, '...');
  }
  console.log('Deleted', deleteCount, 'existing records');

  // Batch write new prospects (500 per batch max)
  console.log('Writing', prospects.length, 'prospects...');
  let written = 0;
  for (let i = 0; i < prospects.length; i += 450) {
    const batch = writeBatch(db);
    const chunk = prospects.slice(i, i + 450);
    for (const p of chunk) {
      const ref = doc(collection(db, 'prospects'));
      batch.set(ref, {
        ...p,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log('  Written', written, 'of', prospects.length);
  }

  console.log('Done! Imported', prospects.length, 'prospects.');
  process.exit(0);
}

main().catch(err => { console.error('Import failed:', err); process.exit(1); });
