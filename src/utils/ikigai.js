// Ikigai: the four circles, their reflection questions, and the scoring that
// turns a set of answers into "where do I stand".
//
// The framework is four overlapping circles. Where two overlap you get a
// named pairing, and where all four overlap is the Ikigai itself:
//
//   What You Love  + What You Are Good At      = Passion
//   What You Love  + What the World Needs      = Mission
//   What You Are Good At + What You Can Be Paid For = Profession
//   What the World Needs + What You Can Be Paid For = Vocation
//
// Each question takes free-text notes plus a 1-5 rating of how much the
// user's work TODAY delivers on it. The notes are for the person; only the
// ratings are scored, because free text can't be scored honestly.

export const IKIGAI_SETTINGS_KEY = 'ikigai';

// Colors checked together with the dataviz palette validator (light surface,
// all pairs). Red and aqua sit in the 6-8 colorblind band, which is allowed
// because every circle is also labelled by name.
export const CIRCLES = [
  {
    id: 'love', label: 'What You Love', short: 'Love', color: '#e34948',
    questions: [
      { id: 'love-flow', text: 'What tasks do you perform where you completely lose track of time?' },
      { id: 'love-free', text: 'If you didn’t need the money, which parts of your job would you still do for free?' },
      { id: 'love-research', text: 'What topics do you find yourself researching in your spare time?' },
      { id: 'love-energy', text: 'Which activities leave you feeling energized rather than drained?' },
      { id: 'love-extra-day', text: 'If you had one extra free day every week, what would you spend it making or learning?' },
    ],
  },
  {
    id: 'good', label: 'What You Are Good At', short: 'Good At', color: '#2a78d6',
    questions: [
      { id: 'good-asked', text: 'What do coworkers or friends constantly ask for your help with?' },
      { id: 'good-natural', text: 'Which of your skills feel "natural" or effortless compared to others?' },
      { id: 'good-soft', text: 'What "soft skills" (e.g., empathy, leadership) have you mastered?' },
      { id: 'good-masterclass', text: 'If you had to teach a masterclass tomorrow, what would the subject be?' },
      { id: 'good-proud', text: 'What accomplishment are you most proud of, and which skill made it possible?' },
    ],
  },
  {
    id: 'needs', label: 'What the World Needs', short: 'World Needs', color: '#1baf7a',
    questions: [
      { id: 'needs-problems', text: 'What problems in your industry or community keep you up at night?' },
      { id: 'needs-cause', text: 'Does your current work contribute to a cause you personally believe in?' },
      { id: 'needs-loss', text: 'If your job disappeared, what would be the tangible loss to those you serve?' },
      { id: 'needs-better', text: 'How does your work make someone else’s life easier or better?' },
      { id: 'needs-decade', text: 'What change would you most like to have helped bring about ten years from now?' },
    ],
  },
  {
    id: 'paid', label: 'What You Can Be Paid For', short: 'Paid For', color: '#eda100',
    questions: [
      { id: 'paid-demand', text: 'Is there a clear market demand for the things you love doing?' },
      { id: 'paid-fair', text: 'Are you currently being compensated fairly for the value you provide?' },
      { id: 'paid-adjacent', text: 'What "adjacent" industries would pay for your specific skill set?' },
      { id: 'paid-path', text: 'Can you envision a sustainable, long-term career path in this field?' },
      { id: 'paid-outside', text: 'What have people already paid you for, or offered to, outside your main job?' },
    ],
  },
];

export const OVERLAPS = [
  { id: 'passion', label: 'Passion', of: ['love', 'good'] },
  { id: 'mission', label: 'Mission', of: ['love', 'needs'] },
  { id: 'profession', label: 'Profession', of: ['good', 'paid'] },
  { id: 'vocation', label: 'Vocation', of: ['needs', 'paid'] },
];

export const RATING_LABELS = ['Not at all', 'A little', 'Somewhat', 'Mostly', 'Fully'];

// A circle counts as "strong" from here up (an average rating of 3.4 of 5).
export const STRONG_AT = 60;

const validRating = (r) => (Number.isInteger(r) && r >= 1 && r <= 5 ? r : null);

// Whatever was stored, read it as { [questionId]: { text, rating } }.
export function sanitizeAnswers(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const c of CIRCLES) {
    for (const q of c.questions) {
      const a = raw[q.id];
      if (!a || typeof a !== 'object') continue;
      const text = typeof a.text === 'string' ? a.text : '';
      const rating = validRating(a.rating);
      if (text || rating) out[q.id] = { text, rating };
    }
  }
  return out;
}

// 1-5 maps onto 0-100 so "Not at all" really is empty and "Fully" is full.
const pct = (rating) => ((rating - 1) / 4) * 100;

// Score every circle, every overlap and the center.
//
// A circle's score is the average of its RATED questions; with nothing rated
// it has no score (null) rather than a zero, so an unfinished circle doesn't
// read as a weak one. An overlap is only as strong as its weaker circle, and
// the Ikigai is only as strong as the weakest of all four.
export function scoreIkigai(rawAnswers) {
  const answers = sanitizeAnswers(rawAnswers);
  const circles = {};
  for (const c of CIRCLES) {
    const ratings = c.questions.map(q => answers[q.id]?.rating).filter(Boolean);
    const answered = c.questions.filter(q => answers[q.id]?.text?.trim() || answers[q.id]?.rating).length;
    circles[c.id] = {
      score: ratings.length ? Math.round(ratings.reduce((s, r) => s + pct(r), 0) / ratings.length) : null,
      rated: ratings.length,
      answered,
      total: c.questions.length,
    };
  }
  const weakest = (ids) => {
    const scores = ids.map(id => circles[id].score);
    return scores.some(s => s == null) ? null : Math.min(...scores);
  };
  const overlaps = {};
  for (const o of OVERLAPS) overlaps[o.id] = weakest(o.of);
  return { circles, overlaps, ikigai: weakest(CIRCLES.map(c => c.id)) };
}

// The classic reading of the diagram: what it feels like when exactly one
// circle is missing, keyed by the missing one.
const MISSING_ONE = {
  paid: 'Delight and fullness, but no wealth. You love it, you are good at it and it matters, yet it is not paying its way.',
  needs: 'Satisfaction, but a feeling of uselessness. It is enjoyable, skilled and paid, yet it is hard to see who it really helps.',
  love: 'Comfortable, but a feeling of emptiness. It is skilled, needed and paid, yet it does not light you up.',
  good: 'Excitement, but a sense of uncertainty. You love it, it matters and it pays, yet you are not yet confident in your ability to deliver it.',
};

// Turn the scores into a headline and a sentence, plus the circle to work on.
export function readStanding(scores) {
  const ids = CIRCLES.map(c => c.id);
  const unrated = ids.filter(id => scores.circles[id].score == null);
  const name = (id) => CIRCLES.find(c => c.id === id).label;
  if (unrated.length === ids.length) {
    return { headline: 'Not started', detail: 'Rate a few questions in each circle and your standing shows up here.', focus: null };
  }
  if (unrated.length) {
    return {
      headline: 'In progress',
      detail: `Still to rate: ${unrated.map(name).join(', ')}. The overlaps that depend on them stay blank until then.`,
      focus: unrated[0],
    };
  }
  const strong = ids.filter(id => scores.circles[id].score >= STRONG_AT);
  const weak = ids.filter(id => !strong.includes(id));
  const focus = [...ids].sort((a, b) => scores.circles[a].score - scores.circles[b].score)[0];
  if (!weak.length) {
    return { headline: 'Ikigai', detail: 'All four circles are strong. This is the center of the diagram: work you love, are good at, that the world needs and that pays.', focus };
  }
  if (weak.length === 1) {
    return { headline: `Missing: ${name(weak[0])}`, detail: MISSING_ONE[weak[0]], focus };
  }
  if (strong.length === 2) {
    const pair = OVERLAPS.find(o => o.of.every(id => strong.includes(id)));
    if (pair) {
      return {
        headline: pair.label,
        detail: `Your two strong circles meet at ${pair.label} (${pair.of.map(name).join(' + ')}). ${weak.map(name).join(' and ')} are what is holding the center back.`,
        focus,
      };
    }
    return {
      headline: 'Split',
      detail: `${strong.map(name).join(' and ')} are strong, but they sit on opposite sides of the diagram and do not overlap on their own. Either of the other two circles would join them up.`,
      focus,
    };
  }
  if (strong.length === 1) {
    return { headline: `Anchored in ${name(strong[0])}`, detail: `One circle is strong so far. Building up a neighbouring circle gives you your first overlap.`, focus };
  }
  return { headline: 'Searching', detail: 'None of the four circles is strong in your work today. Start with the one that feels most within reach.', focus };
}

// Where the "you are here" marker sits, as a fraction of the distance from
// the middle of the diagram toward each circle's center (x right, y down,
// both -1..1). Balanced scores land dead center; a lopsided set is pulled
// toward its strong circles. Squaring the scores makes the pull visible.
export const CIRCLE_DIRECTION = { love: [0, -1], good: [-1, 0], needs: [1, 0], paid: [0, 1] };

export function markerOffset(scores) {
  let x = 0, y = 0, total = 0;
  for (const c of CIRCLES) {
    const s = scores.circles[c.id].score;
    if (s == null) continue;
    const w = s * s;
    x += CIRCLE_DIRECTION[c.id][0] * w;
    y += CIRCLE_DIRECTION[c.id][1] * w;
    total += w;
  }
  return total ? { x: x / total, y: y / total } : null;
}

// Paste from a spreadsheet: tab-separated rows whose cells include one of the
// questions and, after it, the answer. Rows are matched on the question's
// letters and digits only, so curly quotes and spacing don't matter. Returns
// { [questionId]: text } for the rows that carried an answer.
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function parsePastedAnswers(pasted) {
  const byText = new Map();
  for (const c of CIRCLES) for (const q of c.questions) byText.set(squash(q.text), q.id);
  const out = {};
  for (const line of String(pasted || '').split(/\r?\n/)) {
    const cells = line.split('\t');
    const at = cells.findIndex(cell => byText.has(squash(cell)));
    if (at < 0) continue;
    const answer = cells.slice(at + 1).join(' ').trim();
    if (answer) out[byText.get(squash(cells[at]))] = answer;
  }
  return out;
}

// The owner's own first answers, taken from the sheet the page was built
// from. Written into the owner's settings once (see ownerSeedUpdates) so the
// page doesn't open blank; after that they are ordinary answers to edit.
export const OWNER_SEED_ANSWERS = {
  'love-flow': 'When I am designing a system or tool',
  'love-free': 'I am not sure that I would do any of it for free',
  'love-research': 'I have been digging into food, nutrition, and AI',
  'love-energy': 'I feel energized when I am running analysis and building tools',
};

// The settings paths to write for the one-time seed, or null when it has
// already run. A question that already has notes keeps them; a rating
// already given is kept alongside the seeded text.
export function ownerSeedUpdates(stored) {
  if (stored?.seeded) return null;
  const answers = sanitizeAnswers(stored?.answers);
  const updates = { [`${IKIGAI_SETTINGS_KEY}.seeded`]: true };
  for (const [id, text] of Object.entries(OWNER_SEED_ANSWERS)) {
    if (answers[id]?.text?.trim()) continue;
    updates[`${IKIGAI_SETTINGS_KEY}.answers.${id}`] = { text, rating: answers[id]?.rating ?? null };
  }
  return updates;
}
