import { withAuth } from './_lib/http.js';
import { describeHubSpotError, describeHubSpotResponse, rejectedOptionValues } from './_lib/hubspotError.js';

const BASE = 'https://api.hubapi.com';

async function hubspotFetch(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function hubspotPost(path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function getAllContacts(token) {
  const contacts = [];
  let after = undefined;
  const properties = [
    'firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle',
    'associatedcompanyid',
    'hs_lead_status', 'lastmodifieddate', 'createdate',
    'notes_last_updated', 'notes_last_contacted', 'num_contacted_notes',
    'hs_sales_email_last_replied', 'hs_email_last_send_date',
    'hs_email_last_open_date', 'hs_email_last_click_date',
    'num_unique_conversion_events',
    'hs_sequences_is_enrolled', 'hs_sequences_actively_enrolled_count',
    'hs_linkedinid', 'linkedin_url', 'hs_linkedin_url',
    'city', 'state', 'country',
    'dans_tags', 'dan_s_tags', 'dans_tag',
    'decision_maker', 'role',
  ];

  while (true) {
    const params = new URLSearchParams({
      limit: '100',
      properties: properties.join(','),
    });
    if (after) params.set('after', after);

    const data = await hubspotFetch(`/crm/v3/objects/contacts?${params}`, token);
    contacts.push(...(data.results || []));

    if (data.paging?.next?.after) {
      after = data.paging.next.after;
    } else {
      break;
    }

    // Safety limit
    if (contacts.length > 10000) break;
  }

  // Single source of truth: overwrite each contact's free-text `company`
  // with the *name* of its primary associated Company record. The text
  // field on contacts drifts from the Company record over time (rename
  // the Company in HubSpot and old contacts keep the stale text); the
  // Company record is the canonical entity and is what the app's Table
  // View rows tie to. Contacts with no Company association get an empty
  // company string so they no longer match any prospect by company text.
  const companyIds = new Set();
  for (const c of contacts) {
    const id = c.properties?.associatedcompanyid;
    if (id) companyIds.add(String(id));
  }
  const companyNames = new Map();
  const idList = [...companyIds];
  for (let i = 0; i < idList.length; i += 100) {
    const batch = idList.slice(i, i + 100);
    try {
      const res = await fetch(`${BASE}/crm/v3/objects/companies/batch/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: ['name'], inputs: batch.map(id => ({ id })) }),
      });
      if (res.ok) {
        const data = await res.json();
        for (const r of (data.results || [])) {
          companyNames.set(String(r.id), r.properties?.name || '');
        }
      }
    } catch {}
  }
  for (const c of contacts) {
    const id = c.properties?.associatedcompanyid;
    const name = id ? (companyNames.get(String(id)) || '') : '';
    // Preserve the contact's own typed company text in a separate field
    // before replacing `company` with the canonical association name.
    // `company` stays the association name (the Table View tie-in relies on
    // that), but name-based matching like the PE Overview "Key Contacts"
    // column can fall back to what the user actually typed on the contact —
    // important when the contact has no Company association (so `company`
    // would be blank) or the association points at a rebranded record.
    const typed = (c.properties?.company || '').trim();
    if (typed) c.properties.companyText = typed;
    c.properties.company = name;
  }
  return contacts;
}

// Loose-match company-name normalizer: lowercase, strip diacritics,
// drop common corporate suffixes, replace any non-alphanumeric run with
// a single space, collapse whitespace. Used to compare candidate
// HubSpot Company names against the user's typed value when the strict
// EQ search doesn't find a match.
const COMPANY_SUFFIX_RE = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp|partners|capital|management)\b\.?/g;
function normalizeCompanyName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(COMPANY_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Find a HubSpot Company record by name. Tries progressively looser
// matches so subtle variants (case, trailing whitespace, "Inc"/"LLC"
// suffixes, punctuation) still find an existing record instead of
// kicking off a duplicate-create that often fails. Returns the HubSpot
// id, or null when nothing matches even after fuzzy normalization.
async function findCompanyByName(token, rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  // 1. Strict EQ — fast path when the name lines up exactly.
  try {
    const res = await fetch(`${BASE}/crm/v3/objects/companies/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'name', operator: 'EQ', value: name }] }],
        properties: ['name'],
        limit: 1,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const hit = (data.results || [])[0];
      if (hit?.id) return { id: String(hit.id), name: hit.properties?.name || name };
    }
  } catch { /* fall through */ }
  // 2. CONTAINS_TOKEN with the leading distinctive token, then
  // normalize-and-compare the candidates client-side. Catches
  // "Starwood Capital Group" against an existing "Starwood Capital"
  // or "Starwood Capital Group LLC" or "Starwood Capital Group, L.P."
  const tokens = name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const probe = tokens[0] && tokens[0].length >= 3 ? tokens[0] : name;
  try {
    const res = await fetch(`${BASE}/crm/v3/objects/companies/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: probe }] }],
        properties: ['name'],
        limit: 50,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const candidates = (data.results || []).map(r => ({ id: String(r.id), name: r.properties?.name || '' }));
      if (candidates.length > 0) {
        const target = normalizeCompanyName(name);
        // Prefer exact normalized match. Fall back to shortest candidate
        // whose normalized form contains the target — that's typically
        // the closest "real" company without extra qualifiers.
        const exact = candidates.find(c => normalizeCompanyName(c.name) === target);
        if (exact) return { id: exact.id, name: exact.name };
        const partial = candidates
          .filter(c => {
            const n = normalizeCompanyName(c.name);
            return n && (n.includes(target) || target.includes(n));
          })
          .sort((a, b) => a.name.length - b.name.length)[0];
        if (partial) return { id: partial.id, name: partial.name };
      }
    }
  } catch { /* fall through */ }
  return null;
}

// Create a Company record. Returns either { ok: true, id } or
// { ok: false, status, errorText } so the caller can surface the
// real reason (permissions, duplicate name validation, etc.) instead
// of a generic miss.
async function createCompanyByName(token, rawName) {
  const name = String(rawName || '').trim();
  if (!name) return { ok: false, status: 0, errorText: 'Empty company name' };
  try {
    const res = await fetch(`${BASE}/crm/v3/objects/companies`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { name } }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.id) return { ok: true, id: String(data.id) };
      return { ok: false, status: res.status, errorText: 'Create returned no id' };
    }
    return { ok: false, status: res.status, errorText: await describeHubSpotResponse(res) };
  } catch (err) {
    return { ok: false, status: 0, errorText: String(err?.message || err).slice(0, 300) };
  }
}

// Set the contact's primary Company association via the v4 "default"
// endpoint, which handles the primary-company semantics automatically
// (the default contact_to_company association IS the primary). Returns
// { ok, status, errorText } so the caller can surface failures instead
// of silently swallowing them — earlier we had a v3 PUT with a wrong
// associationTypeId that failed quietly and reverted edits on the next
// sync.
async function setContactPrimaryCompany(token, contactId, companyId) {
  try {
    const res = await fetch(`${BASE}/crm/v4/objects/contacts/${contactId}/associations/default/companies/${companyId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (res.ok) return { ok: true };
    return { ok: false, status: res.status, errorText: await describeHubSpotResponse(res) };
  } catch (err) {
    return { ok: false, status: 0, errorText: String(err?.message || err).slice(0, 300) };
  }
}

// Point a contact's primary Company association at the Company record
// matching a free-text company name — finding an existing record by
// exact name, or creating one when there's no match. This is the piece
// that makes a typed `company` value stick: getAllContacts() rewrites
// every contact's `company` text from its associated Company's name on
// each sync, so without a real association the value is blanked on the
// next refresh and the contact vanishes from the company popup. Returns
// a companyAssignment summary the client can use to keep its local
// override when the matched Company's name differs from what was typed,
// or null when there's no name to assign.
async function assignContactPrimaryCompanyByName(token, contactId, rawName) {
  const companyName = (rawName || '').trim();
  if (!companyName) return null;
  let match = await findCompanyByName(token, companyName);
  let companyId = match?.id || null;
  let matchedName = match?.name || '';
  let created = false;
  let createError = null;
  if (!companyId) {
    const createRes = await createCompanyByName(token, companyName);
    if (createRes.ok) {
      companyId = createRes.id;
      matchedName = companyName;
      created = true;
    } else {
      createError = createRes;
    }
  }
  if (companyId) {
    const result = await setContactPrimaryCompany(token, contactId, companyId);
    return {
      companyId,
      created,
      matchedName,
      requestedName: companyName,
      nameDiffers: !!matchedName && matchedName.trim().toLowerCase() !== companyName.trim().toLowerCase(),
      ...result,
    };
  }
  return {
    ok: false,
    status: createError?.status || 0,
    errorText: createError?.errorText || 'Failed to find or create Company record',
    requestedName: companyName,
  };
}

// Apply a contact's edited company name by RENAMING the Company record the
// contact is already linked to — the behavior we want: the canonical
// Company object in HubSpot takes the new name, so it cascades to every
// contact associated with that company and survives the next sync (which
// derives each contact's company from its associated Company's name).
//
// This deliberately avoids writing the contact↔company association, which
// is the step that was failing with "couldn't pin the Company association".
// We only READ the contact's primary company id (mirrored on the contact as
// `associatedcompanyid`, the same field getAllContacts() uses) and PATCH
// that company's name.
//
// Falls back to find-or-create + associate only when the contact has no
// company linked yet (nothing to rename) — e.g. a freshly created contact.
//
// Returns a summary the client uses to decide whether it still needs a local
// override: on a successful rename the override is cleared, because HubSpot
// now holds the typed name. `mode` is one of renamed | unchanged | rename-
// failed, or the assign summary's shape when it falls back.
async function renameContactCompany(token, contactId, rawName) {
  const newName = (rawName || '').trim();
  if (!newName) return null;

  // The primary associated Company id is mirrored onto the contact as the
  // `associatedcompanyid` property.
  let companyId = '';
  try {
    const res = await fetch(`${BASE}/crm/v3/objects/contacts/${contactId}?properties=associatedcompanyid`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      companyId = String(data.properties?.associatedcompanyid || '').trim();
    }
  } catch { /* fall through to the associate path */ }

  // No company linked yet → nothing to rename. Find or create one and pin it,
  // same path a brand-new contact takes.
  if (!companyId) {
    return assignContactPrimaryCompanyByName(token, contactId, newName);
  }

  // Read the current name so we can no-op when it already matches and report
  // the before/after in the response.
  let oldName = '';
  try {
    const res = await fetch(`${BASE}/crm/v3/objects/companies/${companyId}?properties=name`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      oldName = String(data.properties?.name || '').trim();
    }
  } catch { /* unknown current name — attempt the rename anyway */ }

  if (oldName && oldName.toLowerCase() === newName.toLowerCase()) {
    return { ok: true, mode: 'unchanged', companyId, oldName, newName, requestedName: newName, nameDiffers: false };
  }

  // Rename the Company record itself.
  try {
    const res = await fetch(`${BASE}/crm/v3/objects/companies/${companyId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { name: newName } }),
    });
    if (res.ok) {
      return { ok: true, mode: 'renamed', companyId, oldName, newName, requestedName: newName, nameDiffers: false };
    }
    return {
      ok: false,
      mode: 'rename-failed',
      companyId,
      oldName,
      requestedName: newName,
      status: res.status,
      errorText: await describeHubSpotResponse(res),
    };
  } catch (err) {
    return { ok: false, mode: 'rename-failed', companyId, oldName, requestedName: newName, status: 0, errorText: String(err?.message || err).slice(0, 300) };
  }
}

// Normalize the semicolon-separated `dans_tags` string before we hand
// it to HubSpot. The frontend displays and stores tags with natural
// spacing (e.g. "Efficiency / Renewables"), but the HubSpot enumeration
// on that property only accepts the no-space variant
// ("Efficiency/Renewables"). When the picker's spaced version leaks
// through the API layer, HubSpot rejects the PATCH with
// "[value] was not one of the allowed options". This helper rewrites
// any known-mismatched tags to the form HubSpot expects.
const DANS_TAGS_ALIASES = {
  'Efficiency / Renewables': 'Efficiency/Renewables',
  'efficiency / renewables': 'Efficiency/Renewables',
};
function normalizeDansTagsForHubSpot(raw) {
  if (raw == null) return raw;
  const parts = String(raw).split(';').map(s => s.trim()).filter(Boolean);
  const out = parts
    // "Met In Person" is tracked locally in Prospect Tracker (a checkbox on
    // the contact editor), not in HubSpot — it was removed from the
    // `dans_tags` enumeration, so writing it back triggers a 400. Drop it
    // from every contact write so legacy-tagged contacts save cleanly and
    // the value is never (re-)recorded in HubSpot.
    .filter(t => t.replace(/\s+/g, ' ').toLowerCase() !== 'met in person')
    .map(t => {
      const key = t.replace(/\s+/g, ' ');
      return DANS_TAGS_ALIASES[key] || DANS_TAGS_ALIASES[key.toLowerCase()] || t;
    });
  const seen = new Set();
  const deduped = [];
  for (const t of out) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(t);
  }
  return deduped.join(';');
}
function normalizeContactPropertiesForHubSpot(props) {
  if (!props || typeof props !== 'object') return props;
  const next = { ...props };
  if ('dans_tags' in next) next.dans_tags = normalizeDansTagsForHubSpot(next.dans_tags);
  return next;
}

// HubSpot rejects a contact write with a 400 when a `dans_tags` value
// isn't one of the enumeration's registered options (e.g. the curated
// "Met In Person" tag the UI offers but that was never added to the
// property). Detect that specific failure so the caller can register
// the missing option and retry instead of surfacing a dead-end error.
//
// The validation body doesn't reliably name the property it's complaining
// about — it quotes the rejected VALUE ("Nam only was not one of the
// allowed options: [...]") and may say nothing about `dans_tags` at all.
// Requiring the property name meant those writes skipped the self-heal
// and died on a 400 telling the user to go add the option by hand, which
// is the whole thing this is meant to spare them. So match the rejected
// value against the tags being written instead, and keep the property-name
// test as the fast path. `tagsStr` is the write's own dans_tags value:
// an option error naming something we didn't write belongs to some other
// property and stays a hard error.
function isDansTagsOptionError(status, text, tagsStr = '') {
  if (status !== 400 || !text) return false;
  if (!/was not one of the allowed options/i.test(text)) return false;
  if (/dans_tags/i.test(text)) return true;
  const lower = text.toLowerCase();
  return String(tagsStr)
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .some(t => lower.includes(`${t.toLowerCase()} was not one of the allowed options`));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Re-run a contact write that failed on a missing dans_tags option, once
// the option has been registered. HubSpot validates a write against a
// cached copy of the property schema, so an option added milliseconds ago
// can still be refused — a single immediate retry is a coin flip, and
// losing it looks exactly like the self-heal never running. Backs off
// briefly, and gives up the moment the failure is something else, so the
// delay is only ever paid on a path that was going to fail anyway.
async function retryAfterRegisteringTags(patchFn, tagsStr, attempts = 3, delayMs = 600) {
  let res = await patchFn();
  for (let i = 1; i < attempts && !res.ok; i += 1) {
    let text = '';
    try { text = await res.clone().text(); } catch { /* body unreadable */ }
    if (!isDansTagsOptionError(res.status, text, tagsStr)) break;
    await sleep(delayMs * i);
    res = await patchFn();
  }
  return res;
}

// Case- and spacing-insensitive identity for a tag. HubSpot validates an
// enumeration against the exact option value, but "NAM Only", "Nam only"
// and "NAMOnly" are one tag to anyone using the app — and the bulk
// picker already collapses them this way.
const dansTagKey = (t) => String(t || '').toLowerCase().replace(/\s+/g, '');

// Work out what to do with the tags a write is carrying, given the
// options the property actually has. Returns:
//   canonical — the tag string to write, with every tag that already
//               exists under a different spelling rewritten to HubSpot's
//               own; the rest left as typed
//   toAdd     — the tags genuinely new to the property
//
// The rewrite is the point. Skipping a tag whose lowercase form already
// existed (which is all this used to do) left the write to be retried
// with the exact spelling HubSpot had just refused — so a tag stored as
// "Nam only" could never be written as "NAM Only", no matter how many
// times the self-heal ran. Nothing was registered, nothing changed, and
// the retry failed identically. Deferring to the spelling already on the
// property also keeps near-duplicate options from accumulating, which is
// what the case-insensitive check was protecting in the first place.
//
// Pure and exported so the reconciliation can be tested without a HubSpot
// round trip.
function reconcileDansTags(existingValues, tagsStr) {
  const wanted = String(tagsStr || '').split(';').map(s => s.trim()).filter(Boolean);
  const byKey = new Map();
  for (const v of (existingValues || [])) {
    const k = dansTagKey(v);
    if (k && !byKey.has(k)) byKey.set(k, String(v));
  }
  const canonical = [];
  const toAdd = [];
  const seen = new Set();
  for (const tag of wanted) {
    const k = dansTagKey(tag);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const already = byKey.get(k);
    if (already !== undefined) { canonical.push(already); continue; }
    toAdd.push(tag);
    canonical.push(tag);
  }
  return { canonical: canonical.join(';'), toAdd };
}

// Register any `dans_tags` values that aren't already options on the
// property, appending them so the subsequent contact write validates,
// and report the spelling that write should actually use (see
// reconcileDansTags). Returns { added, canonical }.
async function ensureDansTagsOptions(token, tagsStr) {
  if (!String(tagsStr || '').trim()) return { added: [], canonical: '' };
  const prop = await hubspotFetch('/crm/v3/properties/contacts/dans_tags', token);
  const existing = (prop.options || []).map(o => ({ label: o.label, value: o.value, displayOrder: o.displayOrder, hidden: o.hidden }));
  const { canonical, toAdd } = reconcileDansTags(existing.map(o => o.value), tagsStr);
  if (!toAdd.length) return { added: [], canonical };
  const newOptions = toAdd.map((t, i) => ({ label: t, value: t, displayOrder: existing.length + i, hidden: false }));
  const res = await fetch(`${BASE}/crm/v3/properties/contacts/dans_tags`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ options: [...existing, ...newOptions] }),
  });
  if (!res.ok) {
    throw new Error(
      `HubSpot wouldn't add ${toAdd.map(t => `“${t}”`).join(', ')} to the Dan's Tags allowed values: `
      + `${await describeHubSpotResponse(res)}`,
    );
  }
  // What was actually registered, so a caller whose retry still fails can
  // say whether the tag reached the property at all.
  return { added: toAdd, canonical };
}

async function getContactsByCompany(token, companyName) {
  const data = await hubspotFetch(
    `/crm/v3/objects/contacts/search`,
    token,
  );
  return data;
}

async function getSequences(token) {
  try {
    const data = await hubspotFetch('/automation/v4/sequences', token);
    return data.results || [];
  } catch {
    return [];
  }
}

async function getSequenceEnrollments(token) {
  try {
    const data = await hubspotFetch('/automation/v4/sequences/enrollments?limit=100', token);
    return data.results || [];
  } catch {
    return [];
  }
}

async function getRecentEmails(token) {
  const data = await hubspotFetch('/crm/v3/objects/emails?limit=100&properties=hs_email_subject,hs_email_status,hs_email_direction,hs_timestamp,hs_email_to_email,hs_email_from_email,hs_email_to_firstname,hs_email_to_lastname,hs_email_from_firstname,hs_email_from_lastname&sort=-hs_timestamp', token);
  return data.results || [];
}

async function getRecentCalls(token) {
  const data = await hubspotFetch('/crm/v3/objects/calls?limit=100&properties=hs_call_title,hs_call_status,hs_call_direction,hs_call_duration,hs_timestamp,hs_call_to_number,hs_call_from_number,hs_call_disposition&sort=-hs_timestamp', token);
  return data.results || [];
}

async function getRecentMeetings(token) {
  const data = await hubspotFetch('/crm/v3/objects/meetings?limit=100&properties=hs_meeting_title,hs_meeting_start_time,hs_meeting_end_time,hs_meeting_outcome,hs_timestamp&sort=-hs_timestamp', token);
  return data.results || [];
}

async function getEmailCampaigns(token) {
  try {
    const data = await hubspotFetch('/marketing/v1/emails/with-statistics?limit=50&orderBy=-updated', token);
    return (data.objects || []).map(e => ({
      id: e.id,
      name: e.name,
      subject: e.subject,
      status: e.currentState,
      stats: e.stats?.counters || {},
      updated: e.updated,
      created: e.created,
    }));
  } catch {
    return [];
  }
}

async function handler(req, res) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'HubSpot access token not configured' });
  }

  const action = req.query.action;

  try {
    if (action === 'contacts') {
      const contacts = await getAllContacts(token);
      return res.json({
        contacts: contacts.map(c => ({
          id: c.id,
          ...c.properties,
          // Map HubSpot 'role' property to 'decision_maker' for frontend compatibility
          decision_maker: c.properties.role || c.properties.decision_maker || '',
        })),
        total: contacts.length,
      });
    }

    if (action === 'sequences') {
      const sequences = await getSequences(token);
      return res.json({ sequences });
    }

    if (action === 'enrollments') {
      const enrollments = await getSequenceEnrollments(token);
      return res.json({ enrollments });
    }

    if (action === 'emails') {
      const emails = await getRecentEmails(token);
      return res.json({ emails: emails.map(e => ({ id: e.id, ...e.properties })) });
    }

    if (action === 'campaigns') {
      const campaigns = await getEmailCampaigns(token);
      return res.json({ campaigns });
    }

    if (action === 'debug-activity') {
      const results = {};
      try {
        const emails = await hubspotFetch('/crm/v3/objects/emails?limit=5&properties=hs_email_subject,hs_timestamp&sort=-hs_timestamp', token);
        results.emails = { count: emails.results?.length, ok: true };
      } catch (err) { results.emails = { error: err.message }; }
      try {
        const calls = await hubspotFetch('/crm/v3/objects/calls?limit=5&properties=hs_call_title,hs_timestamp&sort=-hs_timestamp', token);
        results.calls = { count: calls.results?.length, ok: true };
      } catch (err) { results.calls = { error: err.message }; }
      try {
        const meetings = await hubspotFetch('/crm/v3/objects/meetings?limit=5&properties=hs_meeting_title,hs_timestamp&sort=-hs_timestamp', token);
        results.meetings = { count: meetings.results?.length, ok: true };
      } catch (err) { results.meetings = { error: err.message }; }
      return res.json(results);
    }

    if (action === 'debug-emails') {
      try {
        const data = await hubspotFetch('/crm/v3/objects/emails?limit=10&properties=hs_email_subject,hs_email_status,hs_email_direction,hs_timestamp,hs_email_to_email,hs_email_from_email&sort=-hs_timestamp', token);
        return res.json({ count: data.results?.length || 0, total: data.total, results: data.results?.slice(0, 5), paging: data.paging });
      } catch (err) {
        return res.json({ error: err.message });
      }
    }

    if (action === 'debug-engagements') {
      try {
        // Try the engagements API instead
        const data = await hubspotFetch('/engagements/v1/engagements/recent/modified?count=10', token);
        return res.json({ count: data.results?.length || 0, results: data.results?.slice(0, 3) });
      } catch (err) {
        return res.json({ error: err.message });
      }
    }

    if (action === 'activity') {
      // Paginated: fetch one type at a time, one page at a time.
      //
      // We use the CRM *search* endpoint rather than the plain object-list
      // endpoint. The list endpoint (/crm/v3/objects/emails) silently
      // ignores `sort` and returns objects oldest-first by creation order,
      // so a client-side record cap would drop the *newest* activity. Search
      // honours `sorts`, so a DESCENDING hs_timestamp sort puts the newest
      // records first — the client walks every page to keep the full
      // history, newest-first, and any safety truncation drops the oldest.
      //
      // Search has one hard limit: it refuses to page past 10,000 results
      // (offset + limit > 10000). To walk an unbounded history we roll into
      // a new "window" as we approach that ceiling — continuing below the
      // oldest hs_timestamp seen so far via an LTE filter with the offset
      // reset to 0. The `after` cursor we hand back encodes both the
      // in-window offset and the current window boundary as `offset~before`.
      // The boundary is LTE (not LT) so records sharing the boundary
      // millisecond aren't skipped; the client dedupes by id to drop the
      // handful of overlap rows that reappear at each window seam.
      const type = req.query.type || 'email'; // email | call | meeting
      const rawAfter = req.query.after || '';
      const limit = 100;
      // Below this the next search page is safely inside the 10k ceiling;
      // at or above it we roll the window instead of paging further.
      const WINDOW_ROLL_AT = 9900;

      let offset = 0;
      let before = ''; // epoch-ms upper bound (exclusive-of-newer) for the window
      if (rawAfter) {
        const tilde = rawAfter.indexOf('~');
        if (tilde >= 0) {
          offset = parseInt(rawAfter.slice(0, tilde), 10) || 0;
          before = rawAfter.slice(tilde + 1);
        } else {
          offset = parseInt(rawAfter, 10) || 0;
        }
      }

      const propsMap = {
        email: 'hs_email_subject,hs_email_status,hs_email_direction,hs_timestamp,hs_email_to_email,hs_email_from_email,hs_email_to_firstname,hs_email_to_lastname,hs_email_from_firstname,hs_email_from_lastname,hs_email_cc_email,hs_email_cc_firstname,hs_email_cc_lastname',
        call: 'hs_call_title,hs_call_status,hs_call_direction,hs_call_duration,hs_timestamp,hs_call_to_number,hs_call_from_number,hs_call_disposition',
        meeting: 'hs_meeting_title,hs_meeting_start_time,hs_meeting_end_time,hs_meeting_outcome,hs_timestamp,hs_attendee_owner_ids,hs_meeting_external_url,hs_internal_meeting_notes,hs_meeting_body',
      };
      const objectMap = { email: 'emails', call: 'calls', meeting: 'meetings' };
      const objectType = objectMap[type] || 'emails';
      const props = (propsMap[type] || propsMap.email).split(',');

      const body = {
        limit,
        sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
        properties: props,
      };
      if (offset) body.after = String(offset);
      if (before) {
        body.filterGroups = [{ filters: [{ propertyName: 'hs_timestamp', operator: 'LTE', value: before }] }];
      }

      const data = await hubspotPost(`/crm/v3/objects/${objectType}/search`, token, body);
      const objects = data.results || [];

      // The search endpoint doesn't return associations, so recover the
      // associated contact IDs with a batch association read. Meetings need
      // these for attendee names; emails use them to recover recipients on
      // one-to-many / sequence sends that log with a blank hs_email_to_email;
      // calls use them for the contact name / phone fallback.
      const idToContactIds = new Map();
      const ids = objects.map(o => o.id).filter(Boolean);
      if (ids.length) {
        try {
          const assoc = await hubspotPost(
            `/crm/v4/associations/${objectType}/contacts/batch/read`,
            token,
            { inputs: ids.map(id => ({ id })) },
          );
          for (const r of (assoc.results || [])) {
            const fromId = r.from?.id;
            const toIds = (r.to || []).map(t => t.toObjectId).filter(Boolean);
            if (fromId && toIds.length) idToContactIds.set(String(fromId), toIds.map(String));
          }
        } catch (err) {
          // Non-fatal: fall back to whatever the object's own fields carry.
          console.warn('activity association read failed:', err?.message || err);
        }
      }

      const results = objects.map(r => {
        const item = { id: r.id, type, ...r.properties };
        const cids = idToContactIds.get(String(r.id));
        if (cids?.length) item._contactIds = cids;
        return item;
      });

      // Compute the next cursor, rolling to a new hs_timestamp window before
      // we hit search's 10k paging ceiling.
      let nextAfter = null;
      const rawNext = data.paging?.next?.after || null; // in-window offset (string)
      if (rawNext) {
        const nextOffset = parseInt(rawNext, 10) || 0;
        if (nextOffset + limit > WINDOW_ROLL_AT) {
          // Approaching the ceiling — start a fresh window below the oldest
          // timestamp on this page. Fall back to stopping if we can't read
          // a usable boundary (rather than risk a malformed filter).
          const lastTs = objects.length ? objects[objects.length - 1].properties?.hs_timestamp : '';
          const ms = lastTs ? new Date(lastTs).getTime() : NaN;
          nextAfter = Number.isFinite(ms) ? `0~${ms}` : null;
        } else {
          nextAfter = `${nextOffset}~${before}`;
        }
      }

      return res.json({ results, nextAfter, total: data.total || null });
    }

    if (action === 'full-sync') {
      // Get contacts, sequences, campaigns (activity fetched separately by Activity tab)
      const [contacts, sequences, campaigns] = await Promise.all([
        getAllContacts(token),
        getSequences(token),
        getEmailCampaigns(token),
      ]);

      const contactList = contacts.map(c => ({
        id: c.id,
        ...c.properties,
      }));

      return res.json({
        contacts: contactList,
        sequences,
        campaigns,
        syncedAt: new Date().toISOString(),
      });
    }

    if (action === 'create-contact' && req.method === 'POST') {
      const { properties } = req.body;
      if (!properties || !properties.email) {
        return res.status(400).json({ error: 'Email is required to create a contact' });
      }
      const cleanProps = normalizeContactPropertiesForHubSpot(properties);
      const postContact = () => fetch(`${BASE}/crm/v3/objects/contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: cleanProps }),
      });
      let createRes = await postContact();
      // Self-heal a missing dans_tags option (e.g. "Met In Person") the
      // same way update-contact does: register it, then retry once.
      if (!createRes.ok && typeof cleanProps.dans_tags === 'string') {
        const peekText = await createRes.clone().text();
        if (isDansTagsOptionError(createRes.status, peekText, cleanProps.dans_tags)) {
          const { canonical } = await ensureDansTagsOptions(token, cleanProps.dans_tags);
          if (canonical && canonical !== cleanProps.dans_tags) cleanProps.dans_tags = canonical;
          createRes = await retryAfterRegisteringTags(postContact, cleanProps.dans_tags);
        }
      }
      if (createRes.ok) {
        const created = await createRes.json();
        // Establish the primary Company association just like update-contact
        // does. The free-text `company` property alone doesn't survive: the
        // canonical-name sync in getAllContacts() reads the association, not
        // the text, so an unassociated new contact has its `company` blanked
        // on the next refresh and disappears from the company popup.
        let companyAssignment = null;
        if (typeof cleanProps.company === 'string') {
          try {
            companyAssignment = await assignContactPrimaryCompanyByName(token, created.id, cleanProps.company);
          } catch (err) {
            companyAssignment = { ok: false, status: 0, errorText: String(err?.message || err).slice(0, 300), requestedName: (cleanProps.company || '').trim() };
          }
        }
        return res.json({ success: true, contact: { id: created.id, ...created.properties }, companyAssignment });
      }
      // HubSpot returns 409 CONFLICT when a contact with that email already
      // exists. Recover by fetching the existing contact and returning it so
      // the caller can just pick up where it would have. This is the desired
      // behavior for the meeting-attendee flow — the goal is "have this
      // contact available," and it already is.
      if (createRes.status === 409) {
        const errText = await createRes.text();
        const idMatch = errText.match(/Existing ID:\s*(\d+)/);
        if (idMatch) {
          const existingId = idMatch[1];
          const props = 'email,firstname,lastname,jobtitle,phone,company,city,state,country,hs_linkedin_url,hs_linkedinid';
          const getRes = await fetch(`${BASE}/crm/v3/objects/contacts/${existingId}?properties=${encodeURIComponent(props)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (getRes.ok) {
            const got = await getRes.json();
            return res.json({
              success: true,
              alreadyExisted: true,
              contact: { id: got.id, ...got.properties },
            });
          }
        }
        throw new Error(`Contact already exists but could not be fetched: ${errText.slice(0, 300)}`);
      }
      const text = await createRes.text();
      throw new Error(`Create failed ${createRes.status}: ${describeHubSpotError(createRes.status, text)}`);
    }

    if (action === 'update-contact' && req.method === 'POST') {
      const { contactId, properties } = req.body;
      if (!contactId) {
        return res.status(400).json({ error: 'contactId is required' });
      }
      const cleanProps = normalizeContactPropertiesForHubSpot(properties);
      // If `company` is being set, rename the Company record the contact is
      // linked to (see renameContactCompany). That pushes the new name onto
      // the canonical Company object so it cascades to every linked contact
      // and survives the next sync, instead of trying to re-pin an
      // association (the step that was failing). When the contact has no
      // company yet it falls back to find-or-create + associate.
      let companyAssignment = null;
      if (typeof cleanProps.company === 'string') {
        companyAssignment = await renameContactCompany(token, contactId, cleanProps.company);
      }
      const patchContact = () => fetch(`${BASE}/crm/v3/objects/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: cleanProps }),
      });
      let updateRes = await patchContact();
      if (!updateRes.ok) {
        const text = await updateRes.text();
        // Self-heal the "tag was not one of the allowed options" case:
        // reconcile the tags against the property's actual options —
        // registering what's new, and adopting HubSpot's spelling for
        // what already exists under a different one — then retry.
        if (typeof cleanProps.dans_tags === 'string' && isDansTagsOptionError(updateRes.status, text, cleanProps.dans_tags)) {
          const sent = cleanProps.dans_tags;
          const { added, canonical } = await ensureDansTagsOptions(token, sent);
          // patchContact reads cleanProps at call time, so the retry goes
          // out with the corrected spelling.
          if (canonical && canonical !== sent) cleanProps.dans_tags = canonical;
          updateRes = await retryAfterRegisteringTags(patchContact, cleanProps.dans_tags);
          if (!updateRes.ok) {
            const retryText = await updateRes.text();
            // Which stage failed is the whole diagnosis, and it used to be
            // invisible: "the option was never registered", "it was
            // registered and HubSpot still refused", and "the spelling was
            // corrected and it still refused" all arrived as the same raw
            // 400.
            const stillRejected = rejectedOptionValues(retryText, 'dans_tags');
            const detail = describeHubSpotError(updateRes.status, retryText);
            const did = [];
            if (added.length) did.push(`added ${added.map(t => `“${t}”`).join(', ')} to the Dan's Tags allowed values`);
            if (canonical !== sent) did.push(`rewrote the tags to the spelling HubSpot already has (“${canonical}”)`);
            throw new Error(did.length
              ? `${did.join(' and ')}, but HubSpot still rejected `
                + `${stillRejected.length ? stillRejected.map(t => `“${t}”`).join(', ') : 'the write'}. ${detail}`
              : `Update failed ${updateRes.status}: ${detail}`);
          }
        } else {
          throw new Error(`Update failed ${updateRes.status}: ${describeHubSpotError(updateRes.status, text)}`);
        }
      }
      const updated = await updateRes.json();
      return res.json({ success: true, contact: { id: updated.id, ...updated.properties }, companyAssignment });
    }

    if (action === 'create-note' && req.method === 'POST') {
      const { contactId, body: noteBody } = req.body;
      if (!contactId || !noteBody) {
        return res.status(400).json({ error: 'contactId and body are required' });
      }
      const noteRes = await fetch(`${BASE}/crm/v3/objects/notes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: { hs_note_body: noteBody, hs_timestamp: new Date().toISOString() },
          associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }],
        }),
      });
      if (!noteRes.ok) {
        const text = await noteRes.text();
        throw new Error(`Note failed ${noteRes.status}: ${text.slice(0, 300)}`);
      }
      return res.json({ success: true });
    }

    if (action === 'push-contacts' && req.method === 'POST') {
      const { contacts } = req.body;
      if (!contacts || !Array.isArray(contacts)) {
        return res.status(400).json({ error: 'contacts array is required' });
      }

      // First get all existing contacts to match by email
      const existing = await getAllContacts(token);
      const emailMap = new Map();
      for (const c of existing) {
        if (c.properties.email) emailMap.set(c.properties.email.toLowerCase(), c.id);
      }

      let created = 0, updated = 0, errors = [], notesCreated = 0, notesFailed = 0;
      const results = [];

      for (const contact of contacts) {
        const props = {};
        if (contact.firstname) props.firstname = contact.firstname;
        if (contact.lastname) props.lastname = contact.lastname;
        if (contact.email) props.email = contact.email;
        if (contact.phone) props.phone = contact.phone;
        if (contact.company) props.company = contact.company;
        if (contact.jobtitle) props.jobtitle = contact.jobtitle;
        if (contact.hs_linkedin_url) props.hs_linkedin_url = contact.hs_linkedin_url;
        if (contact.city) props.city = contact.city;
        if (contact.state) props.state = contact.state;
        if (contact.country) props.country = contact.country;
        if (contact.dans_tags) props.dans_tags = contact.dans_tags;
        const normProps = normalizeContactPropertiesForHubSpot(props);
        const noteBody = (contact.notes || '').toString().trim();

        if (!props.email) {
          errors.push(`Skipped contact without email: ${contact.firstname || ''} ${contact.lastname || ''}`);
          continue;
        }

        const existingId = emailMap.get(props.email.toLowerCase());
        let contactId = null;

        try {
          if (existingId) {
            const updateRes = await fetch(`${BASE}/crm/v3/objects/contacts/${existingId}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ properties: normProps }),
            });
            if (!updateRes.ok) {
              const text = await updateRes.text();
              errors.push(`Failed to update ${props.email}: ${text.slice(0, 100)}`);
            } else {
              updated++;
              contactId = existingId;
            }
          } else {
            const createRes = await fetch(`${BASE}/crm/v3/objects/contacts`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ properties: normProps }),
            });
            if (!createRes.ok) {
              const text = await createRes.text();
              errors.push(`Failed to create ${props.email}: ${text.slice(0, 100)}`);
            } else {
              const createJson = await createRes.json();
              contactId = createJson?.id;
              created++;
            }
          }

          if (contactId) {
            results.push({ email: props.email, id: contactId });
            // Attach note if provided
            if (noteBody) {
              try {
                const noteRes = await fetch(`${BASE}/crm/v3/objects/notes`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    properties: { hs_note_body: noteBody, hs_timestamp: new Date().toISOString() },
                    associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }],
                  }),
                });
                if (noteRes.ok) notesCreated++;
                else {
                  notesFailed++;
                  const text = await noteRes.text();
                  errors.push(`Note failed for ${props.email}: ${text.slice(0, 100)}`);
                }
              } catch (noteErr) {
                notesFailed++;
                errors.push(`Note error for ${props.email}: ${noteErr.message}`);
              }
            }
          }
        } catch (err) {
          errors.push(`Error for ${props.email}: ${err.message}`);
        }
      }

      return res.json({ success: true, created, updated, errors, total: contacts.length, results, notesCreated, notesFailed });
    }

    // The dans_tags value HubSpot holds right now for a specific set of
    // contacts.
    //
    // dans_tags is a single string, so every tag write is a whole-list
    // overwrite. A bulk tag edit that builds that list from the client's
    // cached snapshot silently reverts anything changed in HubSpot since the
    // last sync, and writes a contact the snapshot has never seen as if they
    // had no tags at all. Reading the live values for exactly the contacts
    // being edited is what stops both.
    //
    // Returns { tags: { id: value }, missing: [id] } — an id HubSpot has no
    // contact for is reported rather than defaulted, so the caller can skip
    // it instead of guessing.
    if (action === 'contact-tags' && req.method === 'POST') {
      const ids = [...new Set((req.body?.contactIds || []).map(v => String(v || '').trim()).filter(Boolean))];
      if (ids.length === 0) return res.json({ tags: {}, missing: [] });
      const tags = {};
      // HubSpot's batch read takes at most 100 inputs per call.
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const data = await hubspotPost('/crm/v3/objects/contacts/batch/read', token, {
          properties: ['dans_tags'],
          inputs: chunk.map(id => ({ id })),
        });
        for (const r of (data.results || [])) {
          tags[String(r.id)] = r.properties?.dans_tags || '';
        }
      }
      return res.json({ tags, missing: ids.filter(id => tags[id] === undefined) });
    }

    if (action === 'properties') {
      const data = await hubspotFetch('/crm/v3/properties/contacts', token);
      const props = (data.results || []).map(p => ({
        name: p.name,
        label: p.label,
        type: p.type,
        groupName: p.groupName,
      }));
      return res.json({ properties: props });
    }

    if (action === 'property-detail') {
      const name = req.query.name;
      if (!name) return res.status(400).json({ error: 'Missing name parameter' });
      const data = await hubspotFetch(`/crm/v3/properties/contacts/${name}`, token);
      return res.json({
        name: data.name,
        label: data.label,
        type: data.type,
        fieldType: data.fieldType,
        options: (data.options || []).map(o => o.label || o.value),
      });
    }

    if (action === 'add-tag-option' && req.method === 'POST') {
      const { tag } = req.body;
      if (!tag) return res.status(400).json({ error: 'tag is required' });
      // Get current property options
      const prop = await hubspotFetch('/crm/v3/properties/contacts/dans_tags', token);
      const existing = (prop.options || []).map(o => ({ label: o.label, value: o.value, displayOrder: o.displayOrder, hidden: o.hidden }));
      // Check if already exists
      if (existing.some(o => o.label.toLowerCase() === tag.toLowerCase())) {
        return res.json({ success: true, message: 'Tag already exists' });
      }
      // Add new option
      const newOption = { label: tag, value: tag, displayOrder: existing.length, hidden: false };
      const updateRes = await fetch(`${BASE}/crm/v3/properties/contacts/dans_tags`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ options: [...existing, newOption] }),
      });
      if (!updateRes.ok) {
        const text = await updateRes.text();
        throw new Error(`Failed to add tag option: ${text.slice(0, 300)}`);
      }
      return res.json({ success: true, tag });
    }

    if (action === 'merge-contacts' && req.method === 'POST') {
      // Merge two HubSpot contacts. The `primaryObjectId` keeps its
      // identity and inherits all properties / engagements from
      // `objectIdToMerge`; the secondary is removed. We pass both
      // through to HubSpot's CRM-objects merge endpoint as documented.
      const { primaryObjectId, objectIdToMerge } = req.body;
      if (!primaryObjectId || !objectIdToMerge) {
        return res.status(400).json({ error: 'primaryObjectId and objectIdToMerge are both required' });
      }
      if (String(primaryObjectId) === String(objectIdToMerge)) {
        return res.status(400).json({ error: 'Cannot merge a contact with itself' });
      }
      const mergeRes = await fetch(`${BASE}/crm/v3/objects/contacts/merge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryObjectId: String(primaryObjectId), objectIdToMerge: String(objectIdToMerge) }),
      });
      if (!mergeRes.ok) {
        const text = await mergeRes.text();
        throw new Error(`Merge failed ${mergeRes.status}: ${text.slice(0, 300)}`);
      }
      const json = await mergeRes.json();
      return res.json({ success: true, primary: json });
    }

    if (action === 'delete-contact' && req.method === 'POST') {
      const { contactId } = req.body;
      if (!contactId) {
        return res.status(400).json({ error: 'contactId is required' });
      }
      const deleteRes = await fetch(`${BASE}/crm/v3/objects/contacts/${contactId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!deleteRes.ok && deleteRes.status !== 204) {
        const text = await deleteRes.text();
        throw new Error(`Delete failed ${deleteRes.status}: ${text.slice(0, 300)}`);
      }
      return res.json({ success: true, deleted: contactId });
    }

    return res.status(400).json({ error: 'Missing or invalid action parameter.' });
  } catch (err) {
    console.error('HubSpot API error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export default withAuth(handler);

// Exported for scripts/dansTagsOptionError.test.mjs and
// scripts/contactTagsRead.test.mjs. Vercel only routes the default export, so
// the extra names don't change the endpoint. `handler` is the unwrapped
// version — the tests supply their own request rather than an auth session.
export { isDansTagsOptionError, normalizeDansTagsForHubSpot, reconcileDansTags, handler as handlerForTests };
