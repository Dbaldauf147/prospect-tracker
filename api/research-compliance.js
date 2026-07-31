// Auto-answer the six corporate-compliance gating questions for a company
// using Claude with web search. Powers the "Research answers" button on the
// Corporate Compliance page: given a company name, returns a Yes/No/Unknown
// verdict per jurisdiction question, a short rationale for each, and
// citation links. The client fills the screening dropdowns from these
// verdicts (the user can still override any answer by hand).
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { researchBudgetMs } from './_lib/researchBudget.js';

// The jurisdiction keys the client persists under, paired with the exact
// question wording so Claude answers the same thing the UI screens for.
// Keep in sync with src/data/corporateComplianceScreening.js.
const QUESTIONS = [
  { key: 'california', question: 'Does the company operate in or sell products or services in California?' },
  { key: 'eu', question: 'Does the company operate in the EU?' },
  { key: 'uk', question: 'Is the company legally incorporated in the UK?' },
  { key: 'australia', question: 'Is the company legally incorporated in Australia?' },
  { key: 'mexico', question: "Does the company issue securities in Mexico, such as through Mexico's stock exchange (e.g. banks, issuers, publicly traded)?" },
  { key: 'brazil', question: "Is the company listed on Brazil's stock exchange?" },
];

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'research-compliance', 30, 5 * 60 * 1000))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { company } = req.body || {};
  if (!company || typeof company !== 'string') {
    return res.status(400).json({ error: 'Missing company name' });
  }

  const questionList = QUESTIONS.map(q => `- "${q.key}": ${q.question}`).join('\n');

  // Web search lets Claude establish where the company operates, where it's
  // incorporated, and where its securities are listed, rather than relying
  // on training-time knowledge. The structured output is a per-question
  // verdict so the card can fill each dropdown and show why.
  const systemPrompt = `You are a corporate-disclosure compliance analyst. For the requested company, use web search to determine the answer to each screening question below. These questions gate which corporate sustainability/financial disclosure regimes may apply (California SB 253/261, EU CSRD, UK, Australia, Mexico CNBV, Brazil CVM).

Questions (answer each by its key):
${questionList}

Be conservative and evidence-based. Answer "Yes" or "No" only when the public record supports it; answer "Unknown" when you cannot find sufficient evidence — do not guess. Consider the whole corporate group (parent and major subsidiaries) when judging where a company operates or is listed, and note in the rationale when a Yes rests on a subsidiary or a parent.

Return ONLY a single JSON object (no prose, no markdown fences) with these fields:
- answers: object mapping each question key to exactly "Yes", "No", or "Unknown".
- notes: object mapping each question key to a one-sentence rationale (plain language; cite the specific fact, e.g. "Incorporated in Delaware; no UK entity found" or "Shares listed on B3 (Brazil) under TICKER"). Keep each under ~200 characters.
- summary: string — 1-2 sentence overview of the company's footprint relevant to these regimes. Empty string if unclear.
- sources: array of { title: string, url: string } — citation list, most authoritative first (official filings / investor relations / exchange listings preferred). Up to 6 entries.
- csrd: object with the specific inputs the EU CSRD waves screen on. Fill what the public record supports; use null for any figure you cannot establish — do NOT estimate or interpolate. Fields:
  - euIncorporated: "Yes" | "No" | "Unknown" — is the company itself legally incorporated in an EU member state?
  - euListed: "Yes" | "No" | "Unknown" — are its securities listed on an EU regulated market? (An EU regulated market means an official exchange in an EU member state, e.g. Euronext, Deutsche Börse Regulated Market, Borsa Italiana. Do not count UK, Swiss, US or other non-EU venues.)
  - globalTurnoverEurM: number | null — consolidated worldwide net turnover in MILLIONS OF EUR. Convert from the reporting currency at a recent rate and say so in the note.
  - euTurnoverEurM: number | null — net turnover generated in the EU, in MILLIONS OF EUR. Many companies do not break this out; return null rather than guessing from a broader "Europe" or "EMEA" segment, and if you use such a segment as a proxy, say so explicitly in the note.
  - topEuSubsidiaryTurnoverEurM: number | null — the highest net turnover of any single EU subsidiary or branch, in MILLIONS OF EUR. This is rarely public; null is the expected answer unless you find subsidiary accounts.
  - employees: number | null — total employee headcount (group-wide).
- csrdNotes: object mapping each csrd field name to a one-sentence rationale naming the source, the period, and any conversion or proxy you applied. Keep each under ~200 characters. Use an empty string for a field you returned as null with nothing to say.

Every question key must appear in both answers and notes.`;

  // The agentic web-search loop can run long, so abort inside the
  // deployment's own function limit — see researchBudget.js for why that
  // limit, not vercel.json's maxDuration, is what has to be beaten.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), researchBudgetMs());
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
        max_tokens: 4096,
        system: systemPrompt,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
        messages: [
          { role: 'user', content: `Screen "${company}" against the six questions. Return the JSON object as specified.` },
        ],
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: `Claude API error: ${errText}` });
    }

    const data = await resp.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

    let jsonText = text;
    const match = text.match(/\{[\s\S]*\}/);
    if (match) jsonText = match[0];

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return res.status(502).json({ error: 'Claude returned malformed JSON', raw: text });
    }

    // Normalize each verdict to exactly Yes / No / Unknown, and keep only a
    // short rationale string. Any missing / unexpected value becomes Unknown.
    const normVerdict = (v) => {
      const s = String(v || '').trim().toLowerCase();
      if (s === 'yes') return 'Yes';
      if (s === 'no') return 'No';
      return 'Unknown';
    };
    const answers = {};
    const notes = {};
    for (const q of QUESTIONS) {
      answers[q.key] = normVerdict(parsed.answers?.[q.key]);
      notes[q.key] = String(parsed.notes?.[q.key] || '').trim().slice(0, 300);
    }
    const sources = Array.isArray(parsed.sources) ? parsed.sources
      .filter(o => o && typeof o === 'object' && (o.url || o.href))
      .map(o => ({ title: String(o.title || o.name || o.url || '').trim(), url: String(o.url || o.href || '').trim() }))
      .filter(o => o.url)
      .slice(0, 6) : [];

    // CSRD inputs. A figure has to arrive as a finite non-negative number to
    // be kept — a string, a range or a negative is a model that didn't follow
    // the shape, and null ("couldn't establish it") is a legitimate answer the
    // card renders as an empty cell for the user to fill in.
    const num = (v) => {
      const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const rawCsrd = parsed.csrd && typeof parsed.csrd === 'object' ? parsed.csrd : {};
    const csrd = {
      euIncorporated: normVerdict(rawCsrd.euIncorporated),
      euListed: normVerdict(rawCsrd.euListed),
      globalTurnoverEurM: num(rawCsrd.globalTurnoverEurM),
      euTurnoverEurM: num(rawCsrd.euTurnoverEurM),
      topEuSubsidiaryTurnoverEurM: num(rawCsrd.topEuSubsidiaryTurnoverEurM),
      employees: num(rawCsrd.employees),
    };
    const rawCsrdNotes = parsed.csrdNotes && typeof parsed.csrdNotes === 'object' ? parsed.csrdNotes : {};
    const csrdNotes = {};
    for (const field of Object.keys(csrd)) {
      csrdNotes[field] = String(rawCsrdNotes[field] || '').trim().slice(0, 300);
    }

    return res.status(200).json({
      answers,
      notes,
      summary: String(parsed.summary || '').trim(),
      sources,
      csrd,
      csrdNotes,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({
        error: `Compliance research timed out after ${Math.round(researchBudgetMs() / 1000)}s. Try again — if it keeps timing out, raise RESEARCH_TIMEOUT_MS (needs a plan whose function limit allows it).`,
      });
    }
    return res.status(500).json({ error: err.message || 'Unknown error' });
  } finally {
    clearTimeout(timeout);
  }
}

export default withAuth(handler);
