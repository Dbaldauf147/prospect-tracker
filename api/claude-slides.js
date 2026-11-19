// Build a timeline PowerPoint with Claude, steered by the instructions and
// knowledge of Dan's "Slides and One Pagers" Claude Project (pasted into the
// app, since the API can't reach a claude.ai Project). The client sends the
// project text and a plain-text brief of the timeline; Claude builds the
// deck as native shapes with the pptx skill, matching the reference slide,
// and the finished file is returned as base64 for the browser to download.
import Anthropic from '@anthropic-ai/sdk';
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { claudeErrorMessage } from './_lib/claudeError.js';
import { buildDeck, cleanProject } from './_lib/claudeSlides.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await enforceRateLimit(res, auth.uid, 'claude-slides', 20, 60 * 60 * 1000))) return;
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const project = cleanProject(req.body?.project);
  if (!project.instructions && !project.knowledge) {
    return res.status(400).json({ error: `Paste the "${project.name}" project's instructions first.` });
  }
  const brief = String(req.body?.brief || '').trim();
  if (!brief) return res.status(400).json({ error: 'The timeline has nothing to put on a slide yet.' });

  const client = new Anthropic();
  try {
    const out = await buildDeck(client, {
      project, brief, request: req.body?.request, title: req.body?.title,
    });
    if (out.error) return res.status(out.status).json({ error: out.error });
    return res.status(200).json(out);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Claude is rate-limited right now - try again in a minute.' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: claudeErrorMessage(err.status, err.message) });
    }
    throw err;
  }
}

export default withAuth(handler);
