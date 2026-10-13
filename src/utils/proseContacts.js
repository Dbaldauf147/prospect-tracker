// People named in free text: the Bulk Add Contacts paste box's reader for a
// paste that carries no email addresses.
//
// The page's other reader pulls "Name <email>" pairs, so a list written for
// a person to read (an account plan, a research summary, a LinkedIn search
// copied out of the browser) used to land as nothing at all. This one reads
// the three shapes those come in:
//
//   • Timothy J. Lobner (Executive Vice President & Chief Operating Officer). He leads...
//   Chris Story - Vice President of FP&A and Corporate Development
//   Jane Doe                      <- a name on its own line
//   Director of Energy Procurement  <- and the title on the next
//
// A LinkedIn profile URL on the person's line, or on a line of its own right
// after it, is kept as their LinkedIn.
//
// Lines that carry an email address are left alone: the email reader already
// handles those, and reading "Jane Doe (jane@x.com)" as a title would be wrong.
// Section headings ("2. The Corporate Finance & FP&A Track", "Focus: ...")
// fall out because a name here is two to four capitalised words and nothing
// else, and a dash-separated title has to read like a job title.

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s)>\]"',;]+/i;

// One word of a name: Capitalised, allowing O'Brien, Smith-Jones, McDonald,
// and accented letters. Middle initials ("J.") and the usual lower-case
// particles (de, van, von) are allowed between them.
const WORD = "[A-Z\\u00C0-\\u00DE][A-Za-z\\u00C0-\\u00FF'\\u2019-]+";
const PART = `(?:${WORD}|[A-Z]\\.|de|del|della|di|da|van|von|der|den|la|le|du|dos|bin|al)`;
const NAME = `${WORD}(?:\\s+${PART}){1,3}`;
const SUFFIX = '(?:,?\\s+(?:Jr\\.?|Sr\\.?|II|III|IV|Ph\\.?D\\.?|CPA|MBA|PE|CFA|CEM|LEED AP))*';

const NAME_PAREN_RE = new RegExp(`^(${NAME})${SUFFIX}\\s*\\(([^)]{2,160})\\)`);
// Name, then a dash / pipe / colon / comma, then the title. The en dash and
// em dash are written as escapes so this file's own text stays clean.
const NAME_SEP_RE = new RegExp(`^(${NAME})${SUFFIX}\\s*(?:[-|:,\\u2013\\u2014])\\s*(.{2,160})$`);
const NAME_ONLY_RE = new RegExp(`^(${NAME})${SUFFIX}$`);

// Words that make a phrase read as a job title: roles, not subjects, so a
// "Focus: procurement, energy..." line under a heading isn't read as one.
// Only the dash form and the name-then-title-line form need it; a
// parenthesis straight after a name is already a strong enough sign.
const TITLE_WORD_RE = /\b(chief|officer|president|vp|svp|evp|avp|vice|director|manager|head|lead|leader|ceo|cfo|coo|cto|cio|cso|cmo|partner|founder|principal|analyst|engineer|coordinator|specialist|controller|treasurer|counsel|associate|executive|administrator|supervisor|owner|chair|chairman|chairwoman|secretary|consultant|advisor|adviser|strategist|architect|buyer|planner|accountant|superintendent|commissioner|trustee)\b/i;

// Leading list markers: bullets, dashes, "1." / "2)" numbering.
const BULLET_RE = /^\s*(?:[•‣◦⁃∙·*>-]+|\d{1,3}[.)])\s*/;

function cleanTitle(raw) {
  let t = String(raw || '').trim();
  // The title ends where the prose about the person starts.
  const stop = t.search(/\.\s|;\s|\s\(|\s+https?:\/\//);
  if (stop >= 0) t = t.slice(0, stop);
  return t.replace(/[\s.,;:]+$/, '').trim();
}

// "Timothy J. Lobner" -> Timothy / Lobner. Middle initials are dropped so the
// estimated email (first.last@) comes out right; other middle words stay with
// the surname.
export function splitProseName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(p => !/^[A-Z]\.$/.test(p));
  if (parts.length === 0) return { firstname: '', lastname: '' };
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') };
}

function linkedinOf(line) {
  const m = LINKEDIN_RE.exec(line || '');
  if (!m) return '';
  const url = m[0].replace(/[.)]+$/, '');
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function parseProseContacts(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/).map(l => l.replace(BULLET_RE, '').trim());
  const out = [];
  const seen = new Set();
  let last = null;

  const push = (name, jobtitle, line) => {
    const { firstname, lastname } = splitProseName(name);
    if (!firstname || !lastname) return null;
    const key = `${firstname} ${lastname}`.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    const row = {
      email: '', firstname, lastname, company: '', phone: '', mobilePhone: '',
      jobtitle: cleanTitle(jobtitle), linkedinUrl: linkedinOf(line),
      city: '', state: '', country: '', dans_tags: '',
    };
    out.push(row);
    return row;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) { last = null; continue; }
    if (EMAIL_RE.test(line)) { last = null; continue; }

    // A bare LinkedIn URL belongs to the person on the line before it.
    const urlOnly = linkedinOf(line);
    if (urlOnly && line.replace(LINKEDIN_RE, '').trim().length <= 1) {
      if (last && !last.linkedinUrl) last.linkedinUrl = urlOnly;
      continue;
    }

    let m = NAME_PAREN_RE.exec(line);
    if (m) { last = push(m[1], m[2], line); continue; }

    m = NAME_SEP_RE.exec(line);
    if (m && TITLE_WORD_RE.test(cleanTitle(m[2]))) { last = push(m[1], m[2], line); continue; }

    m = NAME_ONLY_RE.exec(line);
    if (m) {
      const next = lines[i + 1] || '';
      if (next && !EMAIL_RE.test(next) && !NAME_ONLY_RE.test(next) && TITLE_WORD_RE.test(next) && next.length <= 100) {
        last = push(m[1], next, `${line} ${next}`);
        i += 1;
        continue;
      }
    }
    last = null;
  }
  return out;
}
