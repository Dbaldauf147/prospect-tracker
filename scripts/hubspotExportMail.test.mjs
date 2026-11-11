// "Dan's Company Export" email: finding the CSV link and merging companies.
import assert from 'node:assert/strict';
import { findDownloadLink, unwrapSafeLink, pickExportMessage, mergeCompanies } from '../src/utils/hubspotExportMail.js';

const real = 'https://app.hubspot.com/api/export/v1/download?token=abc&portalId=51444280';
const html = `
  <a href="https://app.hubspot.com/unsubscribe">Unsubscribe </a>
  <a style="x" href="${real.replace('&', '&amp;')}"><span><b>Download CSV</b></span></a>
  <a href="https://app.hubspot.com/reports">View in HubSpot</a>`;
assert.equal(findDownloadLink(html), real, 'the Download CSV button, entities decoded');

const safe = `https://nam02.safelinks.protection.outlook.com/?url=${encodeURIComponent(real)}&amp;data=05`;
assert.equal(findDownloadLink(`<a href='${safe}'>Download CSV</a>`), real, 'Safe Links unwrapped');
assert.equal(unwrapSafeLink('not a url'), 'not a url');
assert.equal(findDownloadLink('<a href="x">View in HubSpot</a>'), '');
assert.equal(findDownloadLink(null), '');

const msgs = [
  { id: '1', subject: "Dan's Company Export", receivedDateTime: '2026-11-09T13:01:00Z' },
  { id: '2', subject: 'Other report', receivedDateTime: '2026-11-11T13:01:00Z' },
  { id: '3', subject: "Dan's Company Export", receivedDateTime: '2026-11-10T13:01:00Z' },
];
assert.equal(pickExportMessage(msgs).id, '3', 'newest matching message');
assert.equal(pickExportMessage([]), null);

const m = mergeCompanies(
  [{ id: '1', name: 'Old Acme' }, { id: '9', name: 'Colleague Co' }],
  [{ id: '1', name: 'Acme' }, { id: '2', name: 'New Co' }, { id: '', name: 'no id' }],
);
assert.deepEqual(m.companies.map(c => c.name), ['Acme', 'Colleague Co', 'New Co'], 'replaced by id, others kept');
assert.equal(m.added, 1);
assert.equal(m.updated, 1);

console.log('PASS  hubspot export mail');
