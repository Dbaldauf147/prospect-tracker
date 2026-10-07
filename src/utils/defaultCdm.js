// The CDM a company being created starts with: this user's CDM name (Dan
// Baldauf on the admin account, else settings.cdmName or the signed-in
// name - see cdmName in App.jsx). Used by both ways Table View creates a
// company, the + New popup and Bulk Add, so they agree. Only ever applied
// on create, and never over a CDM the record already brings.
export function withDefaultCdm(record, cdmName) {
  const name = String(cdmName || '').trim();
  if (!name || String(record?.cdm || '').trim()) return record;
  return { ...record, cdm: name };
}
