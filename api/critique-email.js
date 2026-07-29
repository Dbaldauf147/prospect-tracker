// Sales-coach critique of an email draft via Claude. Takes the
// subject + body text, returns a structured critique (strengths,
// fixes, suggested rewrite). Mirrors the pattern in daily-goals.js
// and research-portfolio.js.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'critique-email', 30, 5 * 60 * 1000))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { subject = '', body = '', context = '' } = req.body || {};
  const trimmedBody = String(body || '').trim();
  if (!trimmedBody) {
    return res.status(400).json({ error: 'Email body is empty — nothing to critique.' });
  }

  // Strip HTML tags for the prompt — the user's draft is rich text from
  // the Quill editor, but for review purposes plain text is what
  // matters. Quill markup like <p> / <br> is rendered as line breaks.
  const plain = String(body || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|h\d|li)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const systemPrompt = `You are a senior B2B sales coach reviewing a cold / warm sales email draft for a Schneider Electric client director. You are direct, specific, and ruthless about anything that wastes the prospect's time. Your job is to make the email shorter, sharper, and more likely to get a reply.

Evaluate against these rubrics:
- **Length** — under 130 words is the bar. If it's longer, name what to cut.
- **Subject line** — does it tell the prospect why they should open? Generic ("Quick question", "Following up", "Touching base") fails.
- **Opening line** — first sentence should be about THEM, not us. "I hope this finds you well" / "I wanted to reach out" / "My name is …" all fail.
- **Specificity** — names a concrete trigger (announcement, recent move, peer outcome) and a concrete claim (number, % saved, peer name). Vague benefit language fails.
- **Call to action** — exactly one ask, low-friction (15-min call, single yes/no), with a clear time anchor.
- **Tone** — peer-to-peer, confident, not pushy or sycophantic. Avoid "humbly", "would love to", overuse of "!".
- **Personalization tokens** — flag any mail-merge tokens (anything in {curly braces} or [brackets]) that look unfilled or wrong for the recipient.

Return ONLY a JSON object, no prose, no markdown fences:
{
  "score": 0-100,
  "verdict": "<one-line summary in <= 18 words>",
  "strengths": ["…", "…"],
  "fixes": [{ "issue": "<what's wrong>", "fix": "<what to do instead, concrete>" }, …],
  "rewrite_subject": "<a tighter subject line>",
  "rewrite_body": "<a tightened version of the email body, plain text, preserves the variable tokens the user has in the draft>"
}

Rules:
- "strengths" can be empty or have up to 3 items. Be honest — don't manufacture compliments.
- "fixes" should have 2-6 items, each one actionable. No vague "be more concise" — say exactly what to cut.
- "rewrite_body" must be shorter than the original unless the original is already under 90 words. Preserve any {firstName}/{company}/{companyType} kind of tokens unchanged.
- If the email is already excellent, score 90+ and keep "fixes" short or empty.`;

  const userMessage = `Subject: ${subject || '(none)'}

Body:
${plain}

${context ? `Additional context (recipient/account info):\n${context}\n\n` : ''}Critique this email and return the JSON described in the system prompt.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: `Claude API error: ${errText}` });
    }

    const data = await resp.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const objMatch = text.match(/\{[\s\S]*\}/);
    let parsed;
    try {
      parsed = JSON.parse(objMatch ? objMatch[0] : text);
    } catch {
      return res.status(502).json({ error: 'Claude returned malformed JSON', raw: text });
    }

    const score = Number.isFinite(Number(parsed?.score)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.score)))) : null;
    const verdict = String(parsed?.verdict || '').trim();
    const strengths = Array.isArray(parsed?.strengths)
      ? parsed.strengths.filter(s => typeof s === 'string').map(s => s.trim()).filter(Boolean)
      : [];
    const fixes = Array.isArray(parsed?.fixes)
      ? parsed.fixes
          .filter(f => f && typeof f === 'object')
          .map(f => ({ issue: String(f.issue || '').trim(), fix: String(f.fix || '').trim() }))
          .filter(f => f.issue || f.fix)
      : [];
    const rewriteSubject = String(parsed?.rewrite_subject || '').trim();
    const rewriteBody = String(parsed?.rewrite_body || '').trim();

    return res.status(200).json({ score, verdict, strengths, fixes, rewriteSubject, rewriteBody });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export default withAuth(handler);
