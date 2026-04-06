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

async function getAllContacts(token) {
  const contacts = [];
  let after = undefined;
  const properties = [
    'firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle',
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
  return contacts;
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
      // Paginated: fetch one type at a time, one page at a time
      const type = req.query.type || 'email'; // email | call | meeting
      const after = req.query.after || '';
      const limit = 100;

      const propsMap = {
        email: 'hs_email_subject,hs_email_status,hs_email_direction,hs_timestamp,hs_email_to_email,hs_email_from_email,hs_email_to_firstname,hs_email_to_lastname,hs_email_from_firstname,hs_email_from_lastname',
        call: 'hs_call_title,hs_call_status,hs_call_direction,hs_call_duration,hs_timestamp,hs_call_to_number,hs_call_from_number,hs_call_disposition',
        meeting: 'hs_meeting_title,hs_meeting_start_time,hs_meeting_end_time,hs_meeting_outcome,hs_timestamp,hs_attendee_owner_ids,hs_meeting_external_url,hs_internal_meeting_notes,hs_meeting_body',
      };
      const objectMap = { email: 'emails', call: 'calls', meeting: 'meetings' };
      const objectType = objectMap[type] || 'emails';
      const props = propsMap[type] || propsMap.email;

      const params = new URLSearchParams({ limit: String(limit), properties: props, sort: '-hs_timestamp' });
      if (after) params.set('after', after);
      // Request contact associations for meetings
      if (type === 'meeting') params.set('associations', 'contacts');

      const data = await hubspotFetch(`/crm/v3/objects/${objectType}?${params}`, token);
      const results = (data.results || []).map(r => {
        const item = { id: r.id, type, ...r.properties };
        // Include associated contact IDs for meetings
        if (type === 'meeting' && r.associations?.contacts?.results) {
          item._contactIds = r.associations.contacts.results.map(a => a.id);
        }
        return item;
      });
      const nextAfter = data.paging?.next?.after || null;

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
      const createRes = await fetch(`${BASE}/crm/v3/objects/contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties }),
      });
      if (!createRes.ok) {
        const text = await createRes.text();
        throw new Error(`Create failed ${createRes.status}: ${text.slice(0, 300)}`);
      }
      const created = await createRes.json();
      return res.json({ success: true, contact: { id: created.id, ...created.properties } });
    }

    if (action === 'update-contact' && req.method === 'POST') {
      const { contactId, properties } = req.body;
      if (!contactId) {
        return res.status(400).json({ error: 'contactId is required' });
      }
      const updateRes = await fetch(`${BASE}/crm/v3/objects/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties }),
      });
      if (!updateRes.ok) {
        const text = await updateRes.text();
        throw new Error(`Update failed ${updateRes.status}: ${text.slice(0, 300)}`);
      }
      const updated = await updateRes.json();
      return res.json({ success: true, contact: { id: updated.id, ...updated.properties } });
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

      let created = 0, updated = 0, errors = [];

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

        if (!props.email) {
          errors.push(`Skipped contact without email: ${contact.firstname || ''} ${contact.lastname || ''}`);
          continue;
        }

        const existingId = emailMap.get(props.email.toLowerCase());

        try {
          if (existingId) {
            // Update existing
            const updateRes = await fetch(`${BASE}/crm/v3/objects/contacts/${existingId}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ properties: props }),
            });
            if (!updateRes.ok) {
              const text = await updateRes.text();
              errors.push(`Failed to update ${props.email}: ${text.slice(0, 100)}`);
            } else {
              updated++;
            }
          } else {
            // Create new
            const createRes = await fetch(`${BASE}/crm/v3/objects/contacts`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ properties: props }),
            });
            if (!createRes.ok) {
              const text = await createRes.text();
              errors.push(`Failed to create ${props.email}: ${text.slice(0, 100)}`);
            } else {
              created++;
            }
          }
        } catch (err) {
          errors.push(`Error for ${props.email}: ${err.message}`);
        }
      }

      return res.json({ success: true, created, updated, errors, total: contacts.length });
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
