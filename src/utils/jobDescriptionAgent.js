// The Agents tab's Job Descriptions agent: every Key Contact (HubSpot
// contact tagged "Dan Key Target", not hidden, not left) whose Job
// Description (settings.contactJobDescriptions, see contactJobDescription.js)
// is still blank. N/A counts as done. The assistant opens each one's LinkedIn
// profile, copies the About section and the current role, and pastes the
// lot back into the section's box in the format parseJobDescriptionPaste
// reads.

import { JOB_DESCRIPTION_NA, jobDescriptionFor } from './contactJobDescription.js';

function tagsOf(c) {
  return String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '').toLowerCase();
}

/** Same rule as the Key Contacts page's selector. */
export function isKeyContact(c) {
  const tags = tagsOf(c);
  if (tags.includes('hide') || tags.includes('left')) return false;
  return tags.includes('dan key target');
}

export function linkedinUrlOf(c) {
  return String(c?.hs_linkedin_url || c?.linkedin_url || '').trim();
}

/**
 * Key Contacts with no Job Description yet, sorted by company then name.
 * `localFields` (settings.contactLocalFields) supplies a typed-in Company.
 */
export function jobDescriptionTargets(contacts, jobDescriptions, localFields = {}) {
  const out = [];
  for (const c of contacts || []) {
    if (!c || !isKeyContact(c)) continue;
    const id = String(c.id || c.vid || '').trim();
    if (!id) continue;
    if (jobDescriptionFor(jobDescriptions, id).trim()) continue;
    const local = localFields?.[id];
    const company = String((local && typeof local._companyOverride === 'string' && local._companyOverride) || c.company || '').trim();
    out.push({
      id,
      name: [c.firstname, c.lastname].filter(Boolean).join(' ').trim() || c.email || 'Unknown',
      company,
      jobtitle: String(c.jobtitle || '').trim(),
      linkedin: linkedinUrlOf(c),
      contact: c,
    });
  }
  out.sort((a, b) => a.company.localeCompare(b.company, undefined, { sensitivity: 'base' })
    || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}

/** The data block appended to the prompt: only the contacts with a LinkedIn URL. */
export function jobDescriptionPromptBlock(targets) {
  const lines = ['Contact ID\tName\tCompany\tJob Title\tLinkedIn URL'];
  for (const t of targets || []) {
    if (!t.linkedin) continue;
    lines.push([t.id, t.name, t.company, t.jobtitle, t.linkedin].map(v => String(v || '').replace(/[\t\r\n]+/g, ' ')).join('\t'));
  }
  return lines.join('\n');
}

// A header line opens each contact's block: "=== 12345 | Stephen Smith ===".
// The name is only there for the person reading it; the id does the work.
const HEADER_RE = /^\s*={3,}\s*(?:contact\s*id\s*:?\s*)?([A-Za-z0-9_-]+)\s*(?:\|[^\n]*?)?\s*={3,}\s*$/i;

/**
 * Reads the assistant's paste into [{ id, text }]. Everything between one
 * header and the next is that contact's description, kept verbatim apart
 * from trimming. A block reading just "N/A" (or empty) becomes the N/A mark.
 * A contact listed twice keeps its last block.
 */
export function parseJobDescriptionPaste(raw) {
  const byId = new Map();
  let cur = null;
  let buf = [];
  const flush = () => {
    if (cur == null) return;
    const text = buf.join('\n').trim();
    byId.set(cur, !text || /^n\/?a\.?$/i.test(text) ? JOB_DESCRIPTION_NA : text);
  };
  for (const line of String(raw || '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = line.match(HEADER_RE);
    if (m) {
      flush();
      cur = m[1];
      buf = [];
    } else if (cur != null) {
      buf.push(line);
    }
  }
  flush();
  return [...byId].map(([id, text]) => ({ id, text }));
}

/** The updateSettings() function that writes a parsed paste in one go. */
export function jobDescriptionsPasteUpdate(entries) {
  return (settings) => {
    const cur = settings?.contactJobDescriptions;
    const map = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
    const next = { ...map };
    let changed = false;
    for (const { id, text } of entries || []) {
      const key = String(id ?? '').trim();
      if (!key || typeof text !== 'string' || !text.trim()) continue;
      if (next[key] === text) continue;
      next[key] = text;
      changed = true;
    }
    return changed ? { contactJobDescriptions: next } : null;
  };
}

export const DEFAULT_AI_PROMPT_JOB_DESCRIPTIONS = `1.  Work through the Key Contacts listed below one at a time. Each one has a Contact ID, a name, a company, a job title and a LinkedIn URL. Make sure you are signed in to LinkedIn first.
2.  Open the contact's LinkedIn URL. Check the profile is the right person (the name and the company should match). If the page won't load, or it is clearly someone else, note it and move on to the next contact.
3.  Find the About section near the top of the profile. If the text is cut off, click "...see more" so you can read all of it. Copy the full About text exactly as written, keeping its line breaks and bullet points. Don't summarise or reword it.
4.  Scroll down to the Experience section and find their current job: the role whose dates end in "Present" (if they have more than one Present role, use the one at the company listed below). Write one line in the form "Current role: <Title>, <Company>, <Dates>, <Location>", for example "Current role: Senior Vice President of Operations, Simon Property Group, Jan 2013 - Present, Greater Indianapolis". If that role has its own description, click "...see more" and copy it in full under that line.
5.  The contact's job description is the About text from step 3, then a blank line, then the current role from step 4. If there is no About section, use just the current role. If there is neither an About section nor a Present role, the job description is N/A.
6.  When every contact is done, go to https://prospect-tracker-ashen.vercel.app/, open the Agents tab and find the AI Prompt (Job Descriptions) section. Click "Paste job descriptions" and paste ALL the job descriptions into the box in one go, in exactly this format, one block per contact, a header line with the Contact ID and name, then the job description underneath:
=== <Contact ID> | <Name> ===
<job description>
    For example:
=== 12345 | Stephen Smith ===
Enterprise-wide responsibility for development and execution of operational and capital strategies...

Current role: Senior Vice President of Operations, Simon Property Group, Jan 2013 - Present, Greater Indianapolis
    Copy the Contact ID exactly as it appears in the list below. Leave out the contacts you skipped in step 2. Then click "Save job descriptions" and check the green "Saved N job descriptions" message matches the number you pasted.
7.  Finally, give me a summary table, one line per contact: Name, Company, LinkedIn URL, Source (About / Current role / Both / N/A / Skipped) and, for any you skipped, why.`;
