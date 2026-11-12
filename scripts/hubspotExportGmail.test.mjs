// The Gmail route for "Dan's Company Export" (api/_lib/hubspotExportGmail.js
// and its use in api/hubspot-export-mail.js), with the IMAP session,
// Firestore and the CSV host faked.
//
// What has to hold:
//   * only allowed senders with the export's subject are read; the newest
//     wins; "FW:" is dropped from the name the app shows,
//   * an attached zip or CSV is read in place of the link; with no
//     attachment the Download CSV link is downloaded,
//   * a missing label says how to make one,
//   * the scheduled run loads it for the admin and skips Outlook for them,
//   * ?action=gmail is the admin's only, and status tells the admin where
//     to forward to.
import assert from 'node:assert/strict';
import JSZip from 'jszip';

process.env.OUTLOOK_CLIENT_ID = 'id';
process.env.OUTLOOK_CLIENT_SECRET = 'secret';
const { fetchExportFromGmail, isExportSender } = await import('../api/_lib/hubspotExportGmail.js');
const { runScheduled, handler } = await import('../api/hubspot-export-mail.js');
const { readChunkedValue } = await import('../api/_lib/firestoreChunks.js');

let passed = 0;
const ok = (name) => { passed++; console.log(`PASS  ${name}`); };

const csv = 'Record ID,Company name,Company Domain Name,Company owner\n101,Acme,acme.com,Dan Baldauf\n102,Beta,,Dan Baldauf\n';
const csvUrl = 'https://app.hubspot.com/export/file.csv?token=1';
const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  if (String(url) === csvUrl) return new Response(csv, { headers: { 'content-type': 'text/csv' } });
  throw new Error(`unexpected fetch ${url}`);
};

const NOW = Date.parse('2026-11-12T16:00:00Z');
const at = (iso) => Date.parse(iso);
function session(messages, opened = {}) {
  return async ({ label }) => {
    opened.label = label;
    return {
      async *messages() { for (const m of messages) yield m; },
      async close() { opened.closed = true; },
    };
  };
}
const linkMail = (over = {}) => ({
  from: 'daniel.baldauf@se.com', subject: "FW: Dan's Company Export", messageId: '<a@x>',
  date: at('2026-11-12T14:40:00Z'), html: `<p>fwd</p><a href="${csvUrl}">Download CSV</a>`, attachments: [], ...over,
});
const base = { user: 'app@gmail.com', pass: 'pw', now: () => NOW };

// ---- Senders -------------------------------------------------------------
assert.equal(isExportSender('noreply@notifications.hubspot.com'), true);
assert.equal(isExportSender('daniel.baldauf@se.com'), true);
assert.equal(isExportSender('someone.else@se.com'), false);
assert.equal(isExportSender('noreply@notifications.hubspot.com.evil.io'), false);
ok('only HubSpot and Dan\'s work address are allowed senders by default');

// ---- Link ----------------------------------------------------------------
{
  const opened = {};
  const got = await fetchExportFromGmail({ ...base, connect: session([
    linkMail({ from: 'stranger@se.com', messageId: '<s@x>', date: at('2026-11-12T15:00:00Z') }),
    linkMail({ subject: 'Lunch?', messageId: '<l@x>', date: at('2026-11-12T15:10:00Z') }),
    linkMail({ messageId: '<old@x>', date: at('2026-11-05T14:40:00Z') }),
    linkMail(),
  ], opened) });
  assert.equal(opened.label, 'hubspot-export');
  assert.equal(opened.closed, true);
  assert.equal(got.found, true);
  assert.equal(got.msg.id, 'gmail:<a@x>');
  assert.equal(got.msg.subject, "Dan's Company Export");
  assert.equal(got.msg.receivedDateTime, '2026-11-12T14:40:00.000Z');
  assert.deepEqual(got.companies.map(c => c.id), ['101', '102']);
  assert.ok(fetched.includes(csvUrl));
  ok('the newest allowed export email is read through its Download CSV link, in the label only');
}

// ---- Attachment ------------------------------------------------------------
{
  fetched.length = 0;
  const z = new JSZip();
  z.file("Dan's Company Export.csv", csv);
  const zip = await z.generateAsync({ type: 'nodebuffer' });
  const got = await fetchExportFromGmail({ ...base, connect: session([
    linkMail({ html: '<p>see attached</p>', attachments: [{ filename: 'logo.png', content: Buffer.from('x') }, { filename: 'hubspot-export.zip', content: zip }] }),
  ]) });
  assert.deepEqual(got.companies.map(c => c.name), ['Acme', 'Beta']);
  assert.equal(fetched.length, 0, 'nothing downloaded');
  ok('an attached zip is read in place of the link');

  await assert.rejects(
    fetchExportFromGmail({ ...base, connect: session([linkMail({ html: '<p>nothing</p>' })]) }),
    /no Download CSV link or attached file/,
  );
  ok('no link and no file says so');
}

// ---- Missing label, nothing found -------------------------------------------
{
  await assert.rejects(
    fetchExportFromGmail({ ...base, connect: async () => { throw new Error('label "hubspot-export" not found (NONEXISTENT)'); } }),
    (err) => /label "hubspot-export" doesn't exist yet in app@gmail\.com\. Create it/.test(err.message) && !err.message.includes('—'),
  );
  ok('a missing label says how to make one');
  const none = await fetchExportFromGmail({ ...base, connect: session([]) });
  assert.equal(none.found, false);
  ok('an empty label finds nothing');
}

// ---- The scheduled run and the route ------------------------------------------
function fakeDb() {
  const docs = new Map();
  const docRef = (path) => ({
    path,
    async get() { const d = docs.get(path); return { exists: !!d, data: () => d }; },
    async set(value, opts) { docs.set(path, opts?.merge ? { ...(docs.get(path) || {}), ...value } : { ...value }); },
    async delete() { docs.delete(path); },
    collection: (name) => colRef(`${path}/${name}`),
  });
  const colRef = (path) => ({
    doc: (id) => docRef(`${path}/${id}`),
    async get() {
      const depth = path.split('/').length + 1;
      const list = [...docs.keys()].filter(k => k.startsWith(`${path}/`) && k.split('/').length === depth)
        .map(k => ({ id: k.split('/').pop(), data: () => docs.get(k) }));
      return { docs: list, forEach: (fn) => list.forEach(fn) };
    },
  });
  return {
    docs,
    collection: colRef,
    batch() {
      const ops = [];
      return { set: (r, v) => ops.push(() => r.set(v)), delete: (r) => ops.push(() => r.delete()), commit: async () => { for (const o of ops) await o(); } };
    },
  };
}

{
  const db = fakeDb();
  // The admin also has an Outlook token kept; Outlook must not be asked.
  db.docs.set('integrationTokens/admin', { outlookExport: { refreshToken: 'r' } });
  const results = await runScheduled(db, {
    env: { GMAIL_USER: 'app@gmail.com', GMAIL_APP_PASSWORD: 'pw' },
    resolveAdminUid: async () => 'admin',
    gmail: { ...base, connect: session([linkMail()]) },
  });
  assert.equal(results.length, 1, 'Outlook skipped for the admin once Gmail loaded the email');
  assert.equal(results[0].ok, true, results[0].message);
  assert.match(results[0].message, /Loaded the 11\/12\/2026 email: 2 HubSpot companies\. \(from Gmail\)/);
  const mapping = await readChunkedValue(db.collection('lookupTables').doc('admin').collection('items').doc('hubspot-mapping'), { field: 's' });
  assert.equal(mapping.meta.mailId, 'gmail:<a@x>');
  assert.equal(mapping.meta.file, "Dan's Company Export email");
  ok('the scheduled run loads the Gmail email for the admin');

  const call = (req, auth) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ method: 'GET', headers: {}, query: {}, ...req }, res, auth, { db, gmail: { ...base, connect: session([linkMail()]) } });
  });
  process.env.GMAIL_USER = 'app@gmail.com';
  process.env.GMAIL_APP_PASSWORD = 'pw';
  const denied = await call({ method: 'POST', query: { action: 'gmail' } }, { uid: 'u2', email: 'someone@se.com' });
  assert.equal(denied.code, 403);
  const now = await call({ method: 'POST', query: { action: 'gmail' } }, { uid: 'admin', email: 'baldaufdan@gmail.com' });
  assert.equal(now.code, 200);
  assert.match(now.body.message, /^Up to date with the 11\/12\/2026 email\. \(from Gmail\)$/);
  ok('Check Gmail now is the admin\'s only');

  const status = await call({ query: { action: 'status' } }, { uid: 'admin', email: 'baldaufdan@gmail.com' });
  assert.deepEqual(status.body.gmail, { address: 'app@gmail.com', label: 'hubspot-export' });
  assert.equal(status.body.scheduled, true);
  const other = await call({ query: { action: 'status' } }, { uid: 'u2', email: 'someone@se.com' });
  assert.equal(other.body.gmail, null);
  ok('status tells only the admin where to forward');
}

console.log(`\n${passed} passed`);
