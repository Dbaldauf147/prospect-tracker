// Read one contract document and transcribe the services it puts in scope.
//
// Two input shapes, both from the Clients › Contract Services subtab:
//   { fileName, mediaType: 'application/pdf', dataBase64 }  — Claude reads the
//     PDF itself, which is what handles scanned pages and the service-matrix
//     exhibits that carry the actual scope.
//   { fileName, text }  — already-extracted text (.docx via mammoth, .txt, or
//     a PDF too large to post).
//
// Structured output goes through tool-calling rather than "return JSON":
// evidence quotes are lifted verbatim out of contracts full of quotes and
// newlines, and hand-parsed JSON breaks on them.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

// Vercel caps a serverless request body at 4.5 MB. Base64 inflates by a
// third, so this is the largest PDF that can reach the function at all; the
// browser checks the same ceiling before encoding and falls back to text.
const MAX_BASE64_CHARS = 4_200_000;

// Contracts run long and the tail is usually signature blocks and boilerplate.
// The export this feature is modelled on clipped at 60k; this is generous
// against that while keeping a single call well inside the context budget.
const MAX_TEXT_CHARS = 120_000;

const SYSTEM_PROMPT = `You are reading a commercial energy / sustainability services contract and transcribing exactly which services it puts in scope. You work for the vendor's sales operations team; the output is reviewed by a human before anything is recorded.

Return your answer by calling the record_contract_services tool. Do not write prose.

How to decide what counts as a service:

1. Consolidate to distinct service TYPES, not line items. A service matrix or fee exhibit gets ONE entry per service column heading or per named service, never one per site, meter, account, or fee row.
2. Ignore billing and administrative line items: invoice fees, late fees, deposits, taxes, expenses, travel, pass-through utility charges, minimum commitments, and payment terms are not services.
3. Merge obvious synonyms and near-duplicates into a single entry, using the fullest wording the document gives.
4. Name each service the way THIS document names it. Do not translate it into some other vocabulary and do not invent a name the document does not support.
5. Mark action "remove" only when the document states an entire service type ceases — terminated, deleted, struck, "shall no longer provide", removed from Exhibit A. Dropping sites, meters, accounts, volumes or fees is NOT a service removal; those stay "add".
6. kind is "recurring" for anything ongoing or subscription-like, "one_time" for a project, assessment or deliverable performed once.
7. evidence must be a short verbatim quote from the document — the sentence, heading or table cell the service came from. Never paraphrase it.
7b. scope_language must be this service's scope wording copied out of the document IN FULL and VERBATIM: the whole clause, sub-section or matrix cell that says what the vendor will do, including every sub-bullet, sub-heading and enumerated deliverable under it. This one is filed as the service's contract language and reused when drafting the next contract, so it is a transcription, not a summary — do not shorten it, do not tidy it, do not merge bullets into a sentence, and do not stop at the first sentence. Keep the document's own line breaks between bullets. Where an amendment restates a service's scope, transcribe the restated wording. Leave it an empty string only if the document names the service without ever setting out its scope.
8. confidence is "high" when the document names the service explicitly, "medium" when you inferred it from surrounding language, "low" when it is a guess.
9. If the document genuinely names no services, return an empty services array and say why in scope_note.

Also capture the document's own commercial terms when they are stated: the current term's start and end, whether it auto-renews, the annual escalator, and the payment terms. Quote each one the way the document puts it rather than normalising it — "Net 30", "3% per annum", "renews for successive one-year terms unless either party gives 90 days' written notice". These are reviewed and pasted onto a deal record, so a faithful phrase is worth more than a tidy one. Leave a field as an empty string when the document does not state it; never infer an escalator from a fee table or a renewal from the mere presence of an end date.

Also capture the document's own header facts (client, agreement name, type, dates) when they are stated. Leave a field as an empty string rather than guessing. Set restates_full_scope true only for an amended-and-restated agreement, or an exhibit that replaces the prior service list in full — not for an amendment that adds or removes a few things.`;

const TOOL = {
  name: 'record_contract_services',
  description: 'Record the services this contract puts in scope, plus the contract header facts.',
  input_schema: {
    type: 'object',
    properties: {
      client_name: { type: 'string', description: 'Customer / counterparty name as written. Empty string if not stated.' },
      agreement_name: { type: 'string', description: 'Title of the agreement as written. Empty string if not stated.' },
      agreement_type: { type: 'string', description: 'e.g. Master Services Agreement, Amendment, SOW, Exhibit, Renewal. Empty string if unclear.' },
      effective_date: { type: 'string', description: 'Effective / commencement date as written. Empty string if not stated.' },
      term_start: { type: 'string', description: 'Start of the current term. Empty string if not stated.' },
      term_end: { type: 'string', description: 'End of the current term. Empty string if not stated.' },
      auto_renewal: { type: 'string', description: 'Renewal behaviour as written, including any notice period. Empty string if the document does not say.' },
      escalator: { type: 'string', description: 'Annual escalator / uplift as written, e.g. "3% per annum" or "CPI, capped at 5%". Empty string if not stated.' },
      payment_terms: { type: 'string', description: 'Payment terms as written, e.g. "Net 30 days from invoice date". Empty string if not stated.' },
      restates_full_scope: { type: 'boolean', description: 'True only if this document replaces the prior service list in full.' },
      scope_note: { type: 'string', description: 'One sentence on how this document sets or changes scope.' },
      services: {
        type: 'array',
        description: 'One entry per distinct service type. Empty if the document names none.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The service, named as this document names it.' },
            action: { type: 'string', enum: ['add', 'remove'], description: 'add = in scope, remove = this service type ceases.' },
            kind: { type: 'string', enum: ['recurring', 'one_time'] },
            fee: { type: 'string', description: 'Fee as written, if the document ties one to this service. Empty string otherwise.' },
            effective_date: { type: 'string', description: 'Date this service starts or stops, if stated separately. Empty string otherwise.' },
            evidence: { type: 'string', description: 'Short verbatim quote from the document.' },
            scope_language: { type: 'string', description: 'This service\u2019s full scope wording, transcribed verbatim from the document including every sub-bullet. Not a summary. Empty string only if the document never sets out its scope.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['name', 'action', 'kind', 'evidence', 'confidence'],
        },
      },
    },
    required: ['services', 'scope_note'],
  },
};

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Each call reads a whole contract, so this is metered tighter than the
  // short-prompt endpoints: 20 documents per 15 minutes per user.
  if (!(await enforceRateLimit(res, auth.uid, 'contract-services', 20, 15 * 60 * 1000))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { fileName = '', mediaType = '', dataBase64 = '', text = '' } = req.body || {};
  const isPdf = String(mediaType) === 'application/pdf' && dataBase64;
  const plain = String(text || '').trim();

  if (!isPdf && !plain) {
    return res.status(400).json({ error: 'Nothing to read: send either a PDF (dataBase64) or extracted text.' });
  }
  if (isPdf && String(dataBase64).length > MAX_BASE64_CHARS) {
    return res.status(413).json({ error: 'That PDF is too large to send whole. Extract its text, or split it into smaller files.' });
  }

  const header = `File: ${str(fileName) || '(unnamed)'}`;
  const content = isPdf
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: String(dataBase64) } },
        { type: 'text', text: `${header}\n\nTranscribe the services this contract puts in scope, using the record_contract_services tool.` },
      ]
    : [
        { type: 'text', text: `${header}\n\nContract text:\n"""\n${plain.slice(0, MAX_TEXT_CHARS)}\n"""\n\nTranscribe the services this contract puts in scope, using the record_contract_services tool.` },
      ];

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
        // Transcribing each service's scope wording in full (rather than a
        // one-line quote) is most of this response, and a restated master
        // agreement can carry a dozen services. 8k truncated those mid-tool-
        // call, which surfaces as "no structured result" rather than as the
        // size problem it is.
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: `Claude API error: ${errText}` });
    }

    const data = await resp.json();
    const call = (data.content || []).find(b => b.type === 'tool_use' && b.name === TOOL.name);
    if (!call?.input) {
      // A cut-off tool call and a model that ignored the tool look identical
      // from here — the stop reason is the only thing that tells them apart,
      // and only one of them is fixed by sending less document.
      if (data.stop_reason === 'max_tokens') {
        return res.status(502).json({
          error: 'That contract\u2019s scope wording ran past the reply limit before it finished. Split the document (or send just the pages that carry the scope) and try again.',
        });
      }
      return res.status(502).json({ error: 'Claude did not return a structured result for this document.' });
    }
    const input = call.input;

    const services = (Array.isArray(input.services) ? input.services : [])
      .filter(s => s && typeof s === 'object')
      .map(s => ({
        name: str(s.name),
        action: str(s.action).toLowerCase() === 'remove' ? 'remove' : 'add',
        kind: str(s.kind).toLowerCase() === 'one_time' ? 'one_time' : 'recurring',
        fee: str(s.fee),
        effective_date: str(s.effective_date),
        evidence: str(s.evidence),
        scope_language: str(s.scope_language),
        confidence: ['high', 'medium', 'low'].includes(str(s.confidence).toLowerCase())
          ? str(s.confidence).toLowerCase()
          : 'medium',
      }))
      .filter(s => s.name);

    return res.status(200).json({
      fileName: str(fileName),
      readAs: isPdf ? 'pdf' : 'text',
      clientName: str(input.client_name),
      agreementName: str(input.agreement_name),
      agreementType: str(input.agreement_type),
      effectiveDate: str(input.effective_date),
      termStart: str(input.term_start),
      termEnd: str(input.term_end),
      autoRenewal: str(input.auto_renewal),
      escalator: str(input.escalator),
      paymentTerms: str(input.payment_terms),
      restatesFullScope: input.restates_full_scope === true,
      scopeNote: str(input.scope_note),
      services,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export default withAuth(handler);
