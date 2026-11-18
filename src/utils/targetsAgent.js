// The Agents tab's Targets agent: every company the Issues tab lists as
// missing its targets (the "No targets" rows for clients and prospects and
// the Key Contacts one, all of which carry resolve.kind 'noTargets'). The
// assistant opens each company's popup, asks ChatGPT for its targets
// through the Targets tab's Search web menu, and pastes the table ChatGPT
// gives back into that tab's Paste targets box. Saving the targets (or a
// "No target set" row) clears the issue, so a finished company drops off
// the list by itself.
//
// Pure: scripts/targetsAgent.test.mjs runs it under plain Node.
import { buildTargetSearchLinks } from './targetWebSearch.js';

// How many companies one run of the prompt carries, unless changed on the
// page. Each one is a web-searching ChatGPT chat on a free account, which
// runs out of those long before a full list would be done.
export const TARGETS_AGENT_DEFAULT_BATCH = 10;

const domainOfEmailDomains = (p) => String(p?.emailDomains || p?.emailDomain || '').split(/[\s,;]+/).find(Boolean) || '';

/**
 * One row per company missing its targets, in the Issues tab's order less
 * snoozed rows and repeats. `issues` is useIssues' list; `prospects` the
 * Table View companies (a row whose company is gone from the Table is
 * dropped: there is no popup to open).
 */
export function targetsAgentRows(issues, prospects) {
  const byId = new Map((prospects || []).map(p => [String(p?.id), p]));
  const seen = new Set();
  const out = [];
  for (const r of issues || []) {
    if (r?.resolve?.kind !== 'noTargets' || r.snoozed) continue;
    const id = String(r.prospectId ?? '');
    const prospect = byId.get(id);
    if (!prospect || seen.has(id)) continue;
    seen.add(id);
    const links = buildTargetSearchLinks({ company: prospect.company, website: prospect.website, emailDomain: domainOfEmailDomains(prospect) });
    out.push({
      id,
      company: String(prospect.company || r.company || '').trim(),
      source: r.source || '',
      status: String(prospect.status || '').trim(),
      tier: String(prospect.tier || '').trim(),
      chatgptUrl: links.find(l => /chatgpt/i.test(l.href || ''))?.href || '',
      prospect,
    });
  }
  out.sort((a, b) => a.company.localeCompare(b.company, undefined, { sensitivity: 'base' }));
  return out;
}

/** The data block appended to the prompt: the first `limit` companies. */
export function targetsAgentPromptBlock(rows, limit = TARGETS_AGENT_DEFAULT_BATCH) {
  const n = Math.max(1, Math.floor(Number(limit)) || TARGETS_AGENT_DEFAULT_BATCH);
  const lines = ['Company\tListed under'];
  for (const r of (rows || []).slice(0, n)) {
    lines.push([r.company, r.source].map(v => String(v || '').replace(/[\t\r\n]+/g, ' ')).join('\t'));
  }
  return lines.join('\n');
}

export const DEFAULT_AI_PROMPT_TARGETS = `1.  Go to https://prospect-tracker-ashen.vercel.app/ and open the Agents tab. Find the AI Prompt (Targets) section. Its table lists every company that is missing its target information. Work through the companies listed at the bottom of this prompt one at a time, in order. Make sure you are signed in to ChatGPT first.
2.  In that table, click the company's name. Its company popup opens. Check the name at the top of the popup matches the company you are working on.
3.  Click the Targets tab of the popup.
4.  Click the "Search web" button, then choose "Ask ChatGPT for a targets table (free)". ChatGPT opens in a new browser tab with the prompt already typed into the message box.
5.  Go to that new ChatGPT tab and wait until the prompt has finished loading in the message box. Do not change the prompt. Then click the send (search) button to run it.
6.  Wait until ChatGPT has completely finished answering. It searches the web first, so this can take a minute or more: wait until the answer has stopped growing and the send button is back. The answer is one code block holding a table whose first line starts with "Action | Target Type | Value".
7.  Copy the whole code block (use its Copy button), header line included. If ChatGPT gave more than one table, use the last one. If it asked a question instead of answering, reply "Answer with the table only, using your best reading of the sources" and wait again. If it could not answer at all (an error, or a usage limit), close the ChatGPT tab, note the company as failed, and go to step 10 without pasting anything.
8.  Close the ChatGPT tab and go back to the Prospect Tracker tab. The company popup is still open on its Targets tab. Click "Paste targets" and paste the table into the box that appears. A preview of the rows appears under the box.
9.  Click the blue button under the preview (it reads "Add N targets"). You have full permission to save. Do not ask me for confirmation. If the table has just one row reading "No target set", add it the same way: that records that the company was checked and has none. Check the rows now show in the Targets table. If the button stays greyed out, nothing was read from what you pasted: copy the code block from ChatGPT again and retry once, then note the company as failed.
10. Close the company popup with the X at its top right. Changes on the Targets tab save as they are made, so there is nothing else to click. The company drops off the Agents table once its targets are saved.
11. Repeat steps 2 to 10 for the next company until every company listed below is done. Do not stop to ask whether to continue.
12. Finally, give me a summary table, one line per company: Company, Result (Targets added / No target set / Failed), Number of targets added and, for any that failed, why.`;
