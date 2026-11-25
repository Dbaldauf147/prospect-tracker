// The HubSpot contact behind an Account MRI buying-committee row: by email
// first (most reliable), then by full name, case-insensitively. When nothing
// matches, a minimal record built from the row so the contact popup still
// opens on the name, email, title and phone the row shows.
export function findCommitteeContact(contacts, row) {
  const email = String(row?.email || '').trim().toLowerCase();
  const name = String(row?.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const list = contacts || [];
  let found = email ? list.find(c => String(c?.email || '').trim().toLowerCase() === email) : null;
  if (!found && name) {
    found = list.find(c => [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim().toLowerCase().replace(/\s+/g, ' ') === name);
  }
  if (found) return found;
  const parts = String(row?.name || '').trim().split(/\s+/);
  return {
    firstname: parts[0] || '',
    lastname: parts.slice(1).join(' '),
    email: row?.email || '',
    jobtitle: row?.title || '',
    phone: row?.phone || '',
  };
}
