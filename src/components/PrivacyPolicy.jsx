const sectionStyle = {
  marginBottom: '1.5rem',
};

const headingStyle = {
  fontSize: 'var(--font-size-lg)',
  fontWeight: 700,
  color: 'var(--color-text)',
  marginBottom: '0.5rem',
};

const subHeadingStyle = {
  fontSize: 'var(--font-size-base)',
  fontWeight: 600,
  color: 'var(--color-text)',
  marginBottom: '0.35rem',
  marginTop: '1rem',
};

const paragraphStyle = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-secondary)',
  lineHeight: 1.7,
  margin: '0 0 0.5rem 0',
};

const listStyle = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-secondary)',
  lineHeight: 1.8,
  margin: '0.25rem 0 0.5rem 1.25rem',
  paddingLeft: 0,
};

export function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: '720px', margin: '2rem auto', padding: '2rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-md)', fontFamily: 'var(--font-family)' }}>
      <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, color: 'var(--color-text)', marginBottom: '0.25rem' }}>
        Privacy Policy
      </h1>
      <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
        Last updated: April 2026
      </p>

      <div style={sectionStyle}>
        <h2 style={headingStyle}>Data We Collect</h2>
        <p style={paragraphStyle}>
          Prospect Tracker processes the following categories of data to provide its core functionality:
        </p>
        <ul style={listStyle}>
          <li><strong>HubSpot contacts</strong> — names, email addresses, phone numbers, company names, job titles, lifecycle stages, and custom properties synced from your HubSpot CRM.</li>
          <li><strong>Email activity</strong> — email metadata (sender, recipient, subject, timestamps) and call/meeting engagement records retrieved via HubSpot and Microsoft Graph APIs.</li>
          <li><strong>Prospect and account data</strong> — target accounts, tiers, tags, notes, and pipeline information you enter or import into the application.</li>
          <li><strong>Authentication data</strong> — your Google account email address and unique user ID used for sign-in.</li>
          <li><strong>Audit logs</strong> — records of user actions (logins, contact edits, deletions, bulk operations) for security and accountability.</li>
        </ul>
      </div>

      <div style={sectionStyle}>
        <h2 style={headingStyle}>Where Data Is Stored</h2>
        <ul style={listStyle}>
          <li><strong>Google Firebase / Firestore</strong> — authentication credentials, user roles, prospect records, and audit logs are stored in Firestore databases hosted by Google Cloud.</li>
          <li><strong>Vercel Serverless Functions</strong> — API proxy routes run on Vercel's edge infrastructure. No persistent data is stored on Vercel; it acts as a pass-through to HubSpot and other services.</li>
          <li><strong>Browser localStorage</strong> — contact and activity caches are kept in your browser for faster load times. This data never leaves your device unless you explicitly sync.</li>
        </ul>
      </div>

      <div style={sectionStyle}>
        <h2 style={headingStyle}>Third-Party Processors</h2>
        <p style={paragraphStyle}>
          The following third-party services process data on behalf of Prospect Tracker:
        </p>
        <ul style={listStyle}>
          <li><strong>Google Firebase</strong> — authentication, database, and hosting infrastructure.</li>
          <li><strong>Vercel</strong> — serverless function hosting and deployment platform.</li>
          <li><strong>HubSpot API</strong> — CRM data synchronization (contacts, engagements, pipelines).</li>
          <li><strong>Microsoft Graph API</strong> — email and calendar activity retrieval for Outlook accounts.</li>
          <li><strong>AssemblyAI</strong> — audio transcription processing for call recordings when enabled.</li>
        </ul>
      </div>

      <div style={sectionStyle}>
        <h2 style={headingStyle}>Data Retention</h2>
        <ul style={listStyle}>
          <li><strong>Audit logs</strong> — retained for 1 year from the date of creation, then automatically purged.</li>
          <li><strong>Contact cache</strong> — refreshed in full on each HubSpot sync. Previous cache data is overwritten, not accumulated.</li>
          <li><strong>Prospect records</strong> — retained in Firestore until explicitly deleted by a user.</li>
          <li><strong>localStorage caches</strong> — persist until cleared by the user or browser.</li>
        </ul>
      </div>

      <div style={sectionStyle}>
        <h2 style={headingStyle}>Your Rights</h2>
        <p style={paragraphStyle}>You may exercise the following rights at any time:</p>
        <ul style={listStyle}>
          <li><strong>Data export</strong> — request a full export of all data associated with your account.</li>
          <li><strong>Data deletion</strong> — request deletion of your account, audit log entries, and any stored prospect data.</li>
          <li><strong>Access and correction</strong> — request a summary of what data is held and correct any inaccuracies.</li>
        </ul>
      </div>

      <div style={{ ...sectionStyle, marginBottom: 0, padding: '1rem 1.25rem', background: 'var(--color-accent-light)', borderRadius: 'var(--radius-lg)' }}>
        <h2 style={{ ...subHeadingStyle, marginTop: 0, color: 'var(--color-accent)' }}>Contact for Privacy Requests</h2>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>
          For any privacy-related questions, data export requests, or deletion requests, please contact:<br />
          <strong>Dan Baldauf</strong> —{' '}
          <a href="mailto:baldaufdan@gmail.com" style={{ color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 600 }}>
            baldaufdan@gmail.com
          </a>
        </p>
      </div>
    </div>
  );
}
