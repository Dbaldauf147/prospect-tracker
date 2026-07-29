// LIGHTWEIGHT STUB for the Lovable export.
//
// In the full app, clicking a contact on the Opps page opens a rich
// ContactEditModal (notes, nicknames, CC maps, families, events, HubSpot
// cross-reference, "met in person" / "invited to" toggles, …). That
// editor lives in a large module that pulls in a big unrelated subtree
// (Target Accounts compare, the Opportunity form, Firestore sync), none
// of which belongs in an Opps/Dropdowns export. So we replace it with a
// minimal placeholder that shows the selected contact and closes again.
//
// The Opps page itself is unchanged — it still wires up all the real
// save handlers; they just have nothing to call here. Recreating the
// full editor is left as an exercise for whoever needs it.

export function ContactEditModal({ contact, onClose }) {
  if (!contact) return null;
  const name = contact.name || contact.fullName ||
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    'Contact';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, maxWidth: 440, width: '100%',
          padding: '24px 28px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>{name}</h2>
        {contact.company && (
          <div style={{ color: '#64748b', marginBottom: 4 }}>{contact.company}</div>
        )}
        {contact.email && (
          <div style={{ color: '#2563eb', marginBottom: 16 }}>{contact.email}</div>
        )}
        <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.5, margin: '12px 0 20px' }}>
          The full contact editor (notes, nicknames, CC routing, events,
          HubSpot details and more) is omitted from this standalone export.
          This placeholder stands in for it so the Opps page stays focused
          on the table and Dropdowns UI.
        </p>
        <div style={{ textAlign: 'right' }}>
          <button
            onClick={onClose}
            style={{
              background: '#0f172a', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontSize: 14,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
