// api/hubspot-export-mail.js end to end, with Graph and the CSV host faked.
import assert from 'node:assert/strict';

process.env.OUTLOOK_CLIENT_ID = 'id';
process.env.OUTLOOK_CLIENT_SECRET = 'secret';
const { handler } = await import('../api/hubspot-export-mail.js');

const csvUrl = 'https://app.hubspot.com/export/file.csv?token=1';
const csv = 'Record ID,Company name,Company Domain Name,Company owner\n101,Acme,acme.com,Dan Baldauf\n102,Beta,,Other Person\n';
const calls = [];
let graphExpired = false;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  calls.push(url);
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (url.includes('/oauth2/v2.0/token')) return json({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 });
  if (url.includes('graph.microsoft.com')) {
    if (graphExpired && init.headers?.Authorization === 'Bearer old') return json({}, 401);
    if (url.includes('/me/messages/')) {
      return json({ id: 'm2', subject: "Dan's Company Export", receivedDateTime: '2026-11-10T13:01:00Z',
        body: { content: `<a href="https://nam02.safelinks.protection.outlook.com/?url=${encodeURIComponent(csvUrl)}&amp;data=1">Download CSV</a>` } });
    }
    return json({ value: [{ id: 'm2', subject: "Dan's Company Export", receivedDateTime: '2026-11-10T13:01:00Z' }] });
  }
  if (url === csvUrl) return new Response(csv, { headers: { 'content-type': 'text/csv' } });
  throw new Error(`unexpected fetch ${url}`);
};

function run(headers, query = {}) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ method: 'GET', headers, query }, res);
  });
}

let out = await run({ 'x-ms-token': 'old' });
assert.equal(out.code, 200);
assert.equal(out.body.found, true);
assert.deepEqual(out.body.companies.map(c => [c.id, c.name, c.domain]), [['101', 'Acme', 'acme.com'], ['102', 'Beta', '']]);
assert.equal(out.body.tokens, null, 'no refresh needed');
assert.ok(calls.includes(csvUrl), 'Safe Links unwrapped before download');
assert.equal(out.body.rows, undefined, 'raw rows only when asked for');
out = await run({ 'x-ms-token': 'old' }, { rows: '1' });
assert.deepEqual(out.body.rows.map(r => r['Company name']), ['Acme', 'Beta'], '?rows=1 hands back the rows for Hubspot Mapping');

graphExpired = true;
out = await run({ 'x-ms-token': 'old', 'x-ms-refresh-token': 'r1' });
assert.equal(out.code, 200);
assert.equal(out.body.tokens.accessToken, 'new', 'expired token refreshed and handed back');

out = await run({});
assert.equal(out.code, 401);

// HubSpot delivers the CSV inside a zip.
const JSZip = (await import('jszip')).default;
const { unzipIfNeeded } = await import('../api/hubspot-export-mail.js');
const z = new JSZip();
z.file('__MACOSX/._report.csv', 'junk');
z.file('readme.txt', 'hi');
z.file("Dan's Company Export.csv", csv);
const zipped = await z.generateAsync({ type: 'nodebuffer' });
assert.equal((await unzipIfNeeded(zipped)).toString(), csv, 'the CSV inside the zip');
const plain = Buffer.from(csv);
assert.equal(await unzipIfNeeded(plain), plain, 'a plain CSV passes through');
const XLSX = await import('xlsx');
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Record ID'], ['1']]), 'S');
const xlsx = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
assert.equal(await unzipIfNeeded(xlsx), xlsx, 'an .xlsx (itself a zip) passes through');
const empty = new JSZip(); empty.file('a.txt', 'x');
await assert.rejects(unzipIfNeeded(await empty.generateAsync({ type: 'nodebuffer' })), /no CSV or Excel/);

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === csvUrl) return new Response(zipped, { headers: { 'content-type': 'application/zip' } });
  return realFetch(url, init);
};
graphExpired = false;
out = await run({ 'x-ms-token': 'new' });
assert.equal(out.code, 200);
assert.deepEqual(out.body.companies.map(c => c.id), ['101', '102'], 'zip download read end to end');

console.log('PASS  hubspot export mail route');
