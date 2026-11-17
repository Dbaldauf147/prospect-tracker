// The "N recipients were emailed by another campaign in the last 3 weeks"
// box under To. Each recipient's row is tinted by how many recent campaigns
// reached them: 1 green, 2 yellow, 3 or more red.
const TONES = {
  green: { background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC' },
  yellow: { background: '#FEF9C3', color: '#854D0E', border: '1px solid #FDE047' },
  red: { background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' },
}

function toneForCount(n) {
  if (n >= 3) return 'red'
  if (n === 2) return 'yellow'
  return 'green'
}

const shortDate = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function RecentCampaignNotice({ hits, days }) {
  if (!hits || hits.length === 0) return null
  return (
    <div
      role="status"
      style={{ margin: '-0.35rem 0 0.75rem', padding: '0.5rem 0.7rem', border: '1px solid #FCD34D', background: '#FFFBEB', borderRadius: 6, fontSize: '0.74rem', color: '#92400E', lineHeight: 1.45 }}
    >
      <div style={{ fontWeight: 700, marginBottom: 2 }}>
        {hits.length === 1 ? '1 recipient was' : `${hits.length} recipients were`} emailed by another campaign in the last {days / 7} weeks
      </div>
      {hits.map(h => (
        <div
          key={h.email}
          data-tone={toneForCount(h.campaigns.length)}
          style={{ ...TONES[toneForCount(h.campaigns.length)], borderRadius: 4, padding: '1px 6px', marginTop: 2 }}
        >
          <strong>{h.name || h.email}</strong>
          {': '}
          {h.campaigns.map(c => `${c.label}${c.lastSentDate ? ` (${shortDate(c.lastSentDate)})` : ''}`).join('; ')}
        </div>
      ))}
    </div>
  )
}
