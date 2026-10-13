// Turn a blob of pasted text into contacts: name, title, LinkedIn URL (and
// an email when one happens to be in there).
//
// What gets pasted is whatever the user had open: a LinkedIn people search
// copied straight off the page (name, "• 2nd", headline, location, the
// Connect button's label), a Sales Navigator list, a couple of columns out
// of a spreadsheet, or lines typed by hand like
// "Jane Doe - Director of Sustainability - linkedin.com/in/janedoe".
// None of those come with a schema, so this reads them the way a person
// would: a line that looks like a person's name starts a contact, the first
// line after it that isn't noise is their title, and a LinkedIn URL or an
// email anywhere nearby belongs to the contact being read.
//
// It is a guess, and the popup that calls it shows every row editable
// before anything is saved. The bias is towards dropping a line rather than
// inventing a contact out of it: a missed person is retyped in a second, a
// "Greater Boston Area" pushed to HubSpot as a contact is a mess to unpick.
//
// Pure, so it can be pinned without a browser (scripts/contactPaste.test.mjs).

import { normalizeCompany } from './companyNorm.js';

// Profile links: /in/ for people, and the Sales Navigator lead links that a
// Sales Nav list copies out with.
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub|sales\/lead|sales\/people)\/[^\s,;|<>"'()]+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// Hyphen, en dash and em dash, each only with space on both sides, so
// "Mary-Jane" and "Vice-President" stay whole. The dashes are spelled as
// escapes, and the line is marked, because this reads them out of pasted
// text rather than showing them.
const STRONG_SEP_RE = /\t|\s+\|\s+|\s+[•·]\s+|\s+[-\u2013\u2014]\s+/; // em-dash-ok: reads pasted text

// Lines LinkedIn (and Sales Navigator) put between the bits worth reading.
const NOISE_RES = [
  /^[•·]?\s*(1st|2nd|3rd\+?)(\s+degree connection)?$/i,
  /degree connection/i,
  /^(connect|message|follow|following|pending|save|saved|more|send inmail|inmail|open|premium|show all.*|see all.*|view in sales navigator)$/i,
  /^status is (online|offline|reachable|away)/i,
  /^view .*profile$/i,
  /mutual connections?$/i,
  /^\d[\d,.]*k?\+?\s+(followers?|connections?|results?)$/i,
  /^(open to work|hiring|provides services)\b/i,
  /^past:/i,
  /^(skills?|summary|about):/i,
  /^\d+\s+(years?|months?|yrs?|mos?)\b.*\b(in role|in company|at company)/i,
  /^(in role|in company)\b/i,
  /^(linkedin member)$/i,
  /^(page \d+|next|previous)$/i,
  /^(contacts?|people|employees?)$/i,
];

// Credentials and suffixes that ride along after a name. Dropped from the
// name rather than read as a title: "Jane Doe, CFA" is not a CFA.
const CREDENTIALS = new Set([
  'jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'mba', 'cpa', 'cfa', 'pe', 'pmp',
  'leed', 'ap', 'bd+c', 'o+m', 'cem', 'cep', 'esq', 'jd', 'ms', 'msc', 'ma', 'bs', 'ba',
  'cfp', 'caia', 'frm', 'shrm-cp', 'shrm-scp', 'phr', 'sphr', 'cscp', 'cpsm', 'fca', 'aca',
  'mph', 'rn', 'aia', 'fma', 'rpa', 'ccim', 'sior', 'cma', 'cia', 'cisa', 'cissp', 'gsap',
  'fsa', 'enc', 'env', 'sp', 'ga', 'id+c', 'well', 'wap', 'fitwel', 'mcr', 'slcr', 'hon',
  'she/her', 'he/him', 'they/them',
]);

// Words that never appear in a person's name but are all over a title or a
// company name. A line carrying one is read as something other than a name.
const NOT_NAME_WORDS = new Set([
  // titles
  'director', 'manager', 'vp', 'svp', 'evp', 'avp', 'president', 'head', 'chief', 'officer',
  'engineer', 'analyst', 'lead', 'leader', 'specialist', 'coordinator', 'associate', 'senior',
  'principal', 'partner', 'founder', 'cofounder', 'co-founder', 'owner', 'ceo', 'cfo', 'coo',
  'cto', 'cio', 'cso', 'cmo', 'chro', 'gm', 'executive', 'consultant', 'advisor', 'adviser',
  'administrator', 'assistant', 'intern', 'supervisor', 'superintendent', 'representative',
  'sustainability', 'energy', 'esg', 'procurement', 'operations', 'facilities', 'facility',
  'finance', 'financial', 'accounting', 'controller', 'treasurer', 'secretary', 'counsel',
  'legal', 'marketing', 'sales', 'strategy', 'development', 'investment', 'investments',
  'portfolio', 'asset', 'assets', 'property', 'properties', 'real', 'estate', 'management',
  'environmental', 'global', 'regional', 'national', 'corporate', 'technical', 'program',
  'project', 'projects', 'team', 'member', 'board', 'chair', 'chairman', 'chairwoman',
  'vice', 'general', 'managing', 'acquisitions', 'construction', 'maintenance',
  'utilities', 'utility', 'climate', 'carbon', 'compliance', 'risk', 'hr', 'it', 'data',
  'of', 'and', 'for', 'the', 'at', 'in', '&', 'to', 'with',
  // places LinkedIn prints under a name
  'area', 'greater', 'metropolitan', 'united', 'states', 'kingdom', 'remote',
  // organisations
  'inc', 'llc', 'ltd', 'corp', 'corporation', 'company', 'group', 'holdings', 'capital',
  'partners', 'llp', 'lp', 'plc', 'trust', 'fund', 'reit', 'university', 'bank', 'services',
  'solutions', 'technologies', 'systems', 'international', 'industries', 'associates',
  // page furniture
  'linkedin', 'profile', 'connection', 'connections', 'followers', 'premium', 'view',
]);

// Lowercase words that belong inside a surname.
const NAME_PARTICLES = new Set(['de', 'da', 'del', 'della', 'der', 'den', 'di', 'du', 'la', 'le', 'van', 'von', 'bin', 'al', 'el', 'dos', 'das', 'ter', 'st', 'st.', 'mc', 'y']);

// A line that names a place rather than a person: "Boston, MA",
// "Greater Chicago Area", "Toronto, Ontario, Canada".
const LOCATION_RE = /(\barea$|\bmetropolitan\b|\bunited states\b|\bunited kingdom\b|\bcanada$|,\s*[A-Z]{2}$|^remote$)/i;

// The last piece of "City, State" / "City, Country": tells a location line
// from "Jane Doe, VP Energy" when both are two pieces around a comma.
const PLACE_NAMES = new Set([
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware',
  'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky',
  'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi',
  'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico',
  'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont',
  'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
  'ontario', 'quebec', 'british columbia', 'alberta', 'england', 'scotland', 'ireland', 'france',
  'germany', 'spain', 'italy', 'netherlands', 'switzerland', 'australia', 'singapore', 'india',
  'japan', 'china', 'hong kong', 'mexico', 'brazil', 'usa', 'us', 'uk', 'canada',
]);

function isLocation(line) {
  if (LOCATION_RE.test(line)) return true;
  const pieces = line.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
  return pieces.length >= 2 && PLACE_NAMES.has(pieces[pieces.length - 1]);
}

function clean(s) {
  return String(s ?? '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
    // Emoji and pictographs people put in their LinkedIn names.
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoise(line) {
  return NOISE_RES.some(re => re.test(line));
}

/** A LinkedIn URL tidied for storing: https, no query string, no trailing slash. */
export function normalizeLinkedinUrl(url) {
  let u = String(url || '').trim().replace(/[.,;:]+$/, '');
  if (!u) return '';
  u = u.replace(/^https?:\/\//i, '');
  u = u.replace(/^([a-z]{2,3}\.)?linkedin\.com/i, 'www.linkedin.com');
  u = u.split(/[?#]/)[0].replace(/\/+$/, '');
  return `https://${u}`;
}

// Strip what rides along after a name: "(She/Her)", ", CFA, LEED AP",
// "Jr.". Returns the bare name text.
function stripNameExtras(s) {
  let t = clean(s).replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  // Everything after the first comma is credentials when every piece is.
  const pieces = t.split(',').map(p => p.trim()).filter(Boolean);
  if (pieces.length > 1 && pieces.slice(1).every(isCredentialRun)) t = pieces[0];
  // Trailing credentials without a comma: "Jane Doe MBA", "John Smith Jr."
  const words = t.split(/\s+/).filter(Boolean);
  while (words.length > 2 && CREDENTIALS.has(words[words.length - 1].toLowerCase().replace(/\.$/, ''))) words.pop();
  return words.join(' ').trim();
}

function isCredentialRun(piece) {
  const words = piece.toLowerCase().replace(/\./g, '').split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every(w => CREDENTIALS.has(w));
}

/** Does this text read as a person's name and nothing else? */
export function isLikelyName(s) {
  const t = stripNameExtras(s);
  if (!t || t.length > 50) return false;
  if (/[\d@/\\:]|https?|www\./i.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  let capitalised = 0;
  for (const w of words) {
    const lw = w.toLowerCase().replace(/[.,]+$/, '');
    if (NOT_NAME_WORDS.has(lw)) return false;
    if (NAME_PARTICLES.has(lw)) continue;
    if (!/^[\p{Lu}][\p{L}'’.-]*$/u.test(w)) return false;
    capitalised += 1;
  }
  return capitalised >= 2;
}

/** "Jane A. van der Berg" -> { firstname: 'Jane', lastname: 'van der Berg' }. */
export function splitName(full) {
  const words = stripNameExtras(full).split(/\s+/).filter(Boolean);
  if (words.length === 0) return { firstname: '', lastname: '' };
  if (words.length === 1) return { firstname: words[0], lastname: '' };
  const firstname = words[0];
  // The surname is the last word plus any particles directly before it.
  let i = words.length - 1;
  while (i - 1 >= 1 && NAME_PARTICLES.has(words[i - 1].toLowerCase())) i -= 1;
  return { firstname, lastname: words.slice(i).join(' ') };
}

// A name read back out of a profile slug, for a URL pasted with no name:
// /in/jane-doe-4b1a2c3 -> "Jane Doe". Pieces carrying a digit are the
// disambiguator LinkedIn tacks on, not part of the name.
export function nameFromLinkedinUrl(url) {
  const m = String(url || '').match(/linkedin\.com\/(?:in|pub)\/([^/?#]+)/i);
  if (!m) return '';
  let slug;
  try { slug = decodeURIComponent(m[1]); } catch { slug = m[1]; }
  const parts = slug.split(/[-_]+/).filter(p => p && !/\d/.test(p));
  if (parts.length < 2) return '';
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

// Where a title stops and prose about the person starts: "VP of FP&A. He
// manages the 17-member team..." Narrow on purpose - "Sr. Director" has a
// full stop too.
const TITLE_PROSE_RE = /\.\s+(?:He|She|They|His|Her|Their|Leads|Oversees|Manages|Runs|Owns|Responsible)\b.*$/;

// "Director of Sustainability at Acme Corp" -> "Director of Sustainability"
// when Acme Corp is the company being added to. Left whole otherwise: the
// "at" half is the only clue the person is somewhere else.
function cleanTitle(s, companyNorm) {
  let t = clean(s).replace(/^(current|title|headline|role|position)\s*:\s*/i, '');
  t = t.replace(TITLE_PROSE_RE, '').replace(/[\s,;|]+$/, '').replace(/(?<!\b(?:Sr|Jr|Inc|Co|Corp|Ltd))\.$/, '');
  if (companyNorm) {
    const m = t.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
    if (m && sameCompany(m[2], companyNorm)) t = m[1].trim();
  }
  return t;
}

function sameCompany(text, companyNorm) {
  const n = normalizeCompany(text);
  if (!n || !companyNorm) return false;
  if (n === companyNorm || n.includes(companyNorm) || companyNorm.includes(n)) return true;
  const a = n.split(' ')[0];
  return a.length >= 3 && a === companyNorm.split(' ')[0];
}

function newRecord() {
  return { name: '', jobtitle: '', linkedin: '', email: '' };
}

// Read the pieces of one line (or one spreadsheet row) into a record.
function absorbParts(rec, parts, companyNorm) {
  for (const raw of parts) {
    const p = clean(raw);
    if (!p || isNoise(p)) continue;
    if (!rec.name && isLikelyName(p)) { rec.name = stripNameExtras(p); continue; }
    if (rec.jobtitle || isLocation(p)) continue;
    if (companyNorm && normalizeCompany(p) === companyNorm) continue;
    rec.jobtitle = cleanTitle(p, companyNorm);
  }
}

// Pull every LinkedIn URL and email out of a line, returning what's left.
function extractLinks(line) {
  const urls = (line.match(LINKEDIN_RE) || []).map(normalizeLinkedinUrl);
  let rest = line.replace(LINKEDIN_RE, ' ');
  const emails = (rest.match(EMAIL_RE) || []).map(e => e.toLowerCase());
  rest = rest.replace(EMAIL_RE, ' ');
  // Labels left dangling once the value is gone: "LinkedIn:", "Email -".
  rest = rest.replace(/\b(linkedin|email|e-mail|profile|url)\s*[:-]?\s*$/i, ' ');
  return { urls, emails, rest: clean(rest).replace(/^[\s,;|:-]+|[\s,;|:-]+$/g, '').trim() };
}

// ---- spreadsheet rows ----------------------------------------------------

const HEADER_FIELDS = [
  ['firstname', /^(first|firstname|givenname|fname)$/],
  ['lastname', /^(last|lastname|surname|familyname|lname)$/],
  ['name', /^(name|fullname|contact|contactname|person|employee|employeename)$/],
  ['jobtitle', /^(title|jobtitle|position|role|headline|designation)$/],
  ['linkedin', /^(linkedin|linkedinurl|linkedinprofile|linkedinprofileurl|profile|profileurl|url)$/],
  ['email', /^(email|emailaddress|workemail|mail)$/],
];

function headerMap(cells) {
  const map = {};
  let hits = 0;
  cells.forEach((c, i) => {
    const n = String(c || '').toLowerCase().replace(/[^a-z]/g, '');
    const hit = HEADER_FIELDS.find(([, re]) => re.test(n));
    if (hit && !Object.values(map).includes(hit[0])) { map[i] = hit[0]; hits += 1; }
  });
  return hits >= 1 && hits >= Math.min(2, cells.filter(c => clean(c)).length) ? map : null;
}

function parseTable(lines, companyNorm) {
  const rows = lines.map(l => l.split('\t'));
  const header = headerMap(rows[0]);
  const body = header ? rows.slice(1) : rows;
  const out = [];
  for (const cells of body) {
    const rec = newRecord();
    let first = '', last = '';
    const loose = [];
    cells.forEach((cell, i) => {
      const { urls, emails, rest } = extractLinks(clean(cell));
      if (urls[0] && !rec.linkedin) rec.linkedin = urls[0];
      if (emails[0] && !rec.email) rec.email = emails[0];
      if (!rest) return;
      const field = header && header[i];
      if (field === 'firstname') first = rest;
      else if (field === 'lastname') last = rest;
      else if (field === 'name') rec.name = stripNameExtras(rest);
      else if (field === 'jobtitle') rec.jobtitle = cleanTitle(rest, companyNorm);
      else if (field === 'linkedin' || field === 'email') { /* value not a link: ignore */ }
      else loose.push(rest);
    });
    if (!header && loose.length >= 2 && !isLikelyName(loose[0]) && isLikelyName(`${loose[0]} ${loose[1]}`)) {
      // First and last name in their own columns, no header to say so.
      rec.name = `${loose.shift()} ${loose.shift()}`;
    }
    absorbParts(rec, loose, companyNorm);
    if (first || last) rec.name = clean(`${first} ${last}`);
    out.push(rec);
  }
  return out;
}

// ---- free text -------------------------------------------------------------

// List markers in front of a line: bullets, a dash or star, "1." / "2)".
const LIST_MARKER_RE = /^(?:[\u2022\u2023\u25E6\u2043\u2219\u00B7*>]+|-(?=\s)|\d{1,3}[.)](?=\s))\s*/;

// "Timothy J. Lobner (Executive Vice President & COO). He leads the field
// teams..." - the way an account plan or a research summary lists people.
// Read as "name - title" and the sentence about them dropped. A parenthesis
// that only holds pronouns or credentials ("(She/Her)", "(CFA)") is left
// for stripNameExtras, which already knows those aren't titles.
function readNameParen(s) {
  const m = s.match(/^([^()]{3,60}?)\s*\(([^()]{2,160})\)/);
  if (!m || !isLikelyName(m[1]) || isCredentialRun(m[2]) || isCredentialRun(m[2].replace(/,/g, ' '))) return s;
  return `${m[1].trim()} - ${m[2].trim()}`;
}

function parseFreeText(lines, companyNorm) {
  const out = [];
  let cur = null;
  const start = () => { cur = newRecord(); out.push(cur); return cur; };

  for (const rawLine of lines) {
    const line = clean(rawLine);
    if (!line || isNoise(line)) continue;
    const links = extractLinks(line);
    const { urls, emails } = links;
    const rest = readNameParen(links.rest.replace(LIST_MARKER_RE, ''));

    // Split what's left into pieces: strong separators first, then a comma
    // after a name ("Jane Doe, VP Energy").
    let parts = rest ? rest.split(STRONG_SEP_RE).map(clean).filter(Boolean) : [];
    if (parts.length === 1 && !isLikelyName(parts[0]) && parts[0].includes(',') && !isLocation(parts[0])) {
      const [head, ...tail] = parts[0].split(',');
      if (isLikelyName(head) && tail.join(',').trim() && !isCredentialRun(tail.join(',').trim())) {
        parts = [head.trim(), tail.join(',').trim()];
      }
    }
    // The company's own name on a line of its own (Sales Navigator prints
    // it under the title) is not a person.
    if (parts.length === 1 && companyNorm && normalizeCompany(parts[0]) === companyNorm) parts = [];
    // A line that only repeats the name already being read (LinkedIn prints
    // it twice) adds nothing.
    if (cur && parts.length === 1 && cur.name && stripNameExtras(parts[0]).toLowerCase() === cur.name.toLowerCase()) parts = [];

    const leadsWithName = parts.length > 0 && isLikelyName(parts[0]);
    if (leadsWithName) {
      start();
      absorbParts(cur, parts, companyNorm);
    } else if (parts.length > 0 && cur) {
      // Only the first piece of a headline: "VP Energy at Acme | Speaker".
      absorbParts(cur, [parts[0]], companyNorm);
    }

    for (const url of urls) {
      if (!cur || (cur.linkedin && cur.linkedin !== url)) start();
      cur.linkedin = url;
    }
    for (const email of emails) {
      if (!cur || (cur.email && cur.email !== email)) start();
      cur.email = email;
    }
  }
  return out;
}

/**
 * Parse pasted text into contacts.
 *
 * Returns [{ firstname, lastname, jobtitle, linkedin, email }], one per
 * person found, in the order they appeared. A person is only returned with
 * a name: one recovered from the LinkedIn URL slug when the paste gave none.
 *
 * options.company  the company being added to; a "Title at <company>"
 *                  loses the "at" half, and a line that is just the
 *                  company's name is not read as anything.
 */
export function parseContactPaste(text, { company = '' } = {}) {
  const companyNorm = normalizeCompany(company);
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const nonEmpty = lines.filter(l => l.trim());
  if (nonEmpty.length === 0) return [];
  const tabbed = nonEmpty.filter(l => l.includes('\t')).length;
  const records = tabbed >= Math.max(1, Math.ceil(nonEmpty.length * 0.6))
    ? parseTable(nonEmpty, companyNorm)
    : parseFreeText(nonEmpty, companyNorm);

  const out = [];
  const seen = new Set();
  for (const r of records) {
    const name = r.name || nameFromLinkedinUrl(r.linkedin);
    if (!name) continue;
    const { firstname, lastname } = splitName(name);
    const key = r.linkedin ? r.linkedin.toLowerCase() : `${firstname} ${lastname}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ firstname, lastname, jobtitle: r.jobtitle || '', linkedin: r.linkedin || '', email: r.email || '' });
  }
  return out;
}
