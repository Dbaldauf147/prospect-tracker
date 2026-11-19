// What to tell the user when a call to the Claude API fails. The API
// answers with JSON ({"type":"error","error":{"type":...,"message":...}},
// and the SDK's err.message is that with the status in front); shown raw
// it reads as a wall of braces. This picks the sentence out of it, and
// for the failures with a known fix (no credits, a bad key, rate limit,
// overload) says what to do instead.
function parts(raw) {
  const text = String(raw ?? '').trim();
  const at = text.indexOf('{');
  if (at >= 0) {
    try {
      const body = JSON.parse(text.slice(at));
      const e = body?.error && typeof body.error === 'object' ? body.error : body;
      if (e?.message) return { type: String(e.type || ''), message: String(e.message) };
    } catch { /* not JSON after all: use the text as it is */ }
  }
  return { type: '', message: text };
}

export function claudeErrorMessage(status, raw) {
  const { type, message } = parts(raw);
  const code = Number(status) || 0;
  if (/credit balance is too low/i.test(message)) {
    return 'The Anthropic API account is out of credits, so Claude features are paused. Add credits under Plans & Billing in the Anthropic Console, then try again.';
  }
  if (code === 401 || type === 'authentication_error') {
    return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in the Vercel project settings.';
  }
  if (code === 429 || type === 'rate_limit_error') return 'Claude is rate-limited right now - try again in a minute.';
  if (code === 529 || type === 'overloaded_error') return 'Claude is overloaded right now - try again in a minute.';
  const detail = message.replace(/\s+/g, ' ').slice(0, 300);
  return `Claude API error${code ? ` ${code}` : ''}${detail ? `: ${detail}` : ''}`;
}
