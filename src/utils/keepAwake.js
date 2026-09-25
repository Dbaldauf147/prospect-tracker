// The arithmetic behind the sidebar's "Keep awake" timer, kept apart from
// the component so it can be tested without a browser.
//
// A session is stored as the moment it ends (epoch ms), or `null` for "until
// I stop it". Storing the end rather than a duration is what lets a reload
// pick the timer back up with the right amount left on it.

export const KEEP_AWAKE_STORAGE_KEY = 'keep-awake-until';

// The presets offered in the menu, in minutes. `0` is "until I stop it".
export const KEEP_AWAKE_PRESETS = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 480, label: '8 hours' },
  { minutes: 0, label: 'Until I stop it' },
];

// The longest custom timer the box accepts: a day.
export const KEEP_AWAKE_MAX_MINUTES = 24 * 60;

// A typed custom duration, in whole minutes, or null when it isn't one.
// Accepts "90", "90m", "1.5h", "2 hours", "1h 30m".
export function parseDurationMinutes(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return clampMinutes(Number(s));
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/g;
  let total = 0;
  let matched = '';
  let m;
  while ((m = re.exec(s))) {
    total += m[2].startsWith('h') ? Number(m[1]) * 60 : Number(m[1]);
    matched += m[0];
  }
  // Anything left over that isn't spacing means the text wasn't a duration.
  if (!matched || s.replace(re, '').trim()) return null;
  return clampMinutes(total);
}

function clampMinutes(n) {
  if (!Number.isFinite(n)) return null;
  const whole = Math.round(n);
  if (whole < 1 || whole > KEEP_AWAKE_MAX_MINUTES) return null;
  return whole;
}

// When a session started now for `minutes` ends; null for "until I stop it".
export function endFor(minutes, now = Date.now()) {
  return minutes > 0 ? now + minutes * 60_000 : null;
}

// Whether a stored session is still running at `now`.
export function isRunning(session, now = Date.now()) {
  if (!session || typeof session !== 'object') return false;
  if (session.until == null) return true;
  return Number.isFinite(session.until) && session.until > now;
}

// "1:05:09" / "4:59" for the time left, counting down to the second.
export function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// The stored session, read defensively: storage can be blocked, and a value
// written by an older build (or by hand) must not break the sidebar.
export function readSession(storage, now = Date.now()) {
  try {
    const raw = storage?.getItem(KEEP_AWAKE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const session = { until: parsed?.until == null ? null : Number(parsed.until) };
    return isRunning(session, now) ? session : null;
  } catch {
    return null;
  }
}

export function writeSession(storage, session) {
  try {
    if (session) storage?.setItem(KEEP_AWAKE_STORAGE_KEY, JSON.stringify({ until: session.until }));
    else storage?.removeItem(KEEP_AWAKE_STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the timer still runs, it just won't
    // survive a reload.
  }
}
