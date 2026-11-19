// "PPT with Claude" on the Timelines page.
//
// The rules worth pinning: the pasted Claude Project's instructions and
// knowledge are what steer the deck (they lead the system prompt), the
// request runs the pptx skill with the timeline picture in its container,
// only files the container made count as the deck (never the upload), and
// the brief carries the stages the graphic draws.
//
// Run: node scripts/claudeSlides.test.mjs
import {
  DEFAULT_PROJECT_NAME, MAX_INSTRUCTIONS_CHARS,
  buildRequest, buildSystemPrompt, cleanProject, deckFileName, outputFileIds,
} from '../api/_lib/claudeSlides.js';
import { buildTimelineBrief } from '../src/utils/claudeSlidesBrief.js';
import { buildDeck } from '../api/_lib/claudeSlides.js';
import Anthropic from '@anthropic-ai/sdk';
import http from 'node:http';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const blank = cleanProject({});
check('a blank project is named Slides and One Pagers', blank.name, DEFAULT_PROJECT_NAME);
check('instructions are capped', cleanProject({ instructions: 'x'.repeat(MAX_INSTRUCTIONS_CHARS + 50) }).instructions.length, MAX_INSTRUCTIONS_CHARS);

const project = cleanProject({ name: 'Slides and One Pagers', instructions: 'Use 3 bullets max.', knowledge: 'Brand: SE green.' });
const sys = buildSystemPrompt(project);
check('system prompt names the project', sys.includes('"Slides and One Pagers"'), true);
check('system prompt carries the instructions', sys.includes('<project_instructions>\nUse 3 bullets max.\n</project_instructions>'), true);
check('system prompt carries the knowledge', sys.includes('<project_knowledge>\nBrand: SE green.\n</project_knowledge>'), true);
check('project text comes before the task rules', sys.indexOf('Use 3 bullets max.') < sys.indexOf('pptx skill'), true);
check('no knowledge block when there is none', buildSystemPrompt(cleanProject({ instructions: 'a' })).includes('project_knowledge'), false);

const req = buildRequest({ project, brief: 'Title: X', request: 'One slide', pngFileId: 'file_png' });
check('runs the pptx skill', req.container.skills, [{ type: 'anthropic', skill_id: 'pptx', version: 'latest' }]);
check('with code execution', req.tools, [{ type: 'code_execution_20260521', name: 'code_execution' }]);
check('code execution beta is on', req.betas.includes('code-execution-2025-08-25'), true);
check('the picture is uploaded to the container first', req.messages[0].content[0], { type: 'container_upload', file_id: 'file_png' });
check('the brief and extra request ride in the text', /Title: X[\s\S]*One slide/.test(req.messages[0].content[1].text), true);
check('no upload block without a picture', buildRequest({ project, brief: 'b' }).messages[0].content.length, 1);

const content = [
  { type: 'text', text: 'ok' },
  { type: 'bash_code_execution_tool_result', content: { type: 'bash_code_execution_result', content: [
    { type: 'bash_code_execution_output', file_id: 'file_png' },
    { type: 'bash_code_execution_output', file_id: 'file_deck' },
  ] } },
  { type: 'container_upload', file_id: 'file_other' },
  { type: 'bash_code_execution_tool_result', content: { content: [{ file_id: 'file_deck' }, { file_id: 'file_deck2' }] } },
];
check('output files exclude uploads and repeats, in order', outputFileIds(content, ['file_png']), ['file_deck', 'file_deck2']);

check('deck filename', deckFileName('Budget timeline: v2'), 'Budget-timeline-v2-Claude.pptx');
check('deck filename fallback', deckFileName(''), 'Timeline-Claude.pptx');

const brief = buildTimelineBrief({
  name: 'Utility bill audit', services: ['Bill audit'],
  stages: [
    { name: 'Kickoff', owner: 'Schneider Electric', start: '2026-01-05', end: '2026-01-05', description: 'Call  with\nclient' },
    { name: 'Data pull', owner: 'Client', timing: 'Q1', duration: 3, durationUnit: 'weeks' },
  ],
});
check('brief has the title', brief.startsWith('Title: Utility bill audit'), true);
check('brief lists services', brief.includes('Services: Bill audit'), true);
check('a one-day stage reads as a date', brief.includes('1. Kickoff | owner: Schneider Electric | date: 2026-01-05'), true);
check('descriptions are one line', brief.includes('   Call with client'), true);
check('second stage keeps owner', brief.includes('2. Data pull | owner: Client'), true);
check('empty timeline says so', buildTimelineBrief({ name: 'x', stages: [] }).includes('(no stages yet)'), true);

// The whole build against a fake Anthropic API, through the real SDK: the
// picture is uploaded, a paused turn is resumed in the same container, the
// .pptx the container saved is downloaded, and every file is cleaned up.
const seen = { uploads: 0, messages: [], deleted: [], downloads: [] };
const sse = (res, msg) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { id: 'msg', type: 'message', role: 'assistant', model: 'm', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 }, container: msg.container } });
  msg.content.forEach((block, index) => {
    if (block.type === 'text') {
      ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } });
    } else {
      ev('content_block_start', { index, content_block: block });
    }
    ev('content_block_stop', { index });
  });
  ev('message_delta', { delta: { stop_reason: msg.stop_reason }, usage: { output_tokens: 1 } });
  ev('message_stop', {});
  res.end();
};
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && req.url.startsWith('/v1/files')) { seen.uploads++; return json({ id: 'file_png', type: 'file', filename: 'timeline.png' }); }
    if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
      const parsed = JSON.parse(body);
      seen.messages.push(parsed);
      if (seen.messages.length === 1) {
        return sse(res, { stop_reason: 'pause_turn', container: { id: 'cont_1', expires_at: '2030-01-01T00:00:00Z' }, content: [{ type: 'server_tool_use', id: 'srv_1', name: 'bash_code_execution', input: { command: 'ls' } }] });
      }
      return sse(res, { stop_reason: 'end_turn', container: { id: 'cont_1', expires_at: '2030-01-01T00:00:00Z' }, content: [
        { type: 'bash_code_execution_tool_result', tool_use_id: 'srv_1', content: { type: 'bash_code_execution_result', stdout: '', stderr: '', return_code: 0, content: [{ type: 'bash_code_execution_output', file_id: 'file_deck' }] } },
        { type: 'text', text: 'Three slides \u2014 cover, timeline, owners.' },
      ] });
    }
    const m = req.url.match(/^\/v1\/files\/([^/?]+)(\/content)?/);
    if (m && req.method === 'DELETE') { seen.deleted.push(m[1]); return json({ id: m[1], type: 'file_deleted' }); }
    if (m && m[2]) { seen.downloads.push(m[1]); res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(Buffer.from('PKdeck')); }
    if (m) return json({ id: m[1], type: 'file', filename: m[1] === 'file_deck' ? 'Timeline.pptx' : 'x.png', mime_type: 'x', size_bytes: 1, created_at: '2026-01-01T00:00:00Z' });
    res.writeHead(404); res.end('{}');
  });
});
await new Promise(r => server.listen(0, r));
const fake = new Anthropic({ apiKey: 'test', baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
const out = await buildDeck(fake, { project, brief: 'Title: X', png: Buffer.from('png').toString('base64'), request: '', title: 'My plan' });
server.close();
check('picture uploaded once', seen.uploads, 1);
check('paused turn resumed', seen.messages.length, 2);
check('resume reuses the container', seen.messages[1].container?.id, 'cont_1');
check('resume sends the paused turn back', seen.messages[1].messages.map(m => m.role), ['user', 'assistant']);
check('the system prompt reached the API', seen.messages[0].system.includes('Use 3 bullets max.'), true);
check('deck downloaded', seen.downloads, ['file_deck']);
check('deck returned as base64', Buffer.from(out.pptx || '', 'base64').toString(), 'PKdeck');
check('deck filename', out.filename, 'My-plan-Claude.pptx');
check('note has no em dash', out.note, 'Three slides - cover, timeline, owners.');
check('upload and deck both deleted', [...seen.deleted].sort(), ['file_deck', 'file_png']);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
