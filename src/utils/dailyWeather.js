// The morning weather popup: where it looks, how it asks, and how it reads
// the answer. Kept free of React so scripts/dailyWeather.test.mjs can run it.
//
// Forecasts come from Open-Meteo (api.open-meteo.com): free, no API key,
// CORS-enabled, so the browser calls it directly. The host is allow-listed
// in vercel.json's connect-src.

export const WEATHER_LOCATION = {
  name: 'Brooklyn, NY',
  latitude: 40.6782,
  longitude: -73.9442,
  timezone: 'America/New_York',
};

// userSettings key holding the local date (YYYY-MM-DD) the popup last
// showed on. Synced, so the popup comes up once a day, not once per device.
export const WEATHER_SEEN_SETTINGS_KEY = 'dailyWeatherSeenDate';

export const WEATHER_DAYS = 3;

const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'apparent_temperature_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'snowfall_sum',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
  'uv_index_max',
  'sunrise',
  'sunset',
];

const CURRENT_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
];

export function weatherUrl(loc = WEATHER_LOCATION, days = WEATHER_DAYS) {
  const q = new URLSearchParams({
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    timezone: loc.timezone,
    forecast_days: String(days),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    daily: DAILY_FIELDS.join(','),
    current: CURRENT_FIELDS.join(','),
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

// Today's date in the viewer's local calendar, as YYYY-MM-DD.
export function localDateKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// `today` is a localDateKey() string.
export function shouldShowWeather(seenDate, today = localDateKey()) {
  return seenDate !== today;
}

// WMO weather interpretation codes, as Open-Meteo documents them.
const WMO = {
  0: ['Clear sky', '☀️'],
  1: ['Mainly clear', '🌤️'],
  2: ['Partly cloudy', '⛅'],
  3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'],
  48: ['Freezing fog', '🌫️'],
  51: ['Light drizzle', '🌦️'],
  53: ['Drizzle', '🌦️'],
  55: ['Heavy drizzle', '🌧️'],
  56: ['Freezing drizzle', '🌧️'],
  57: ['Heavy freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'],
  63: ['Rain', '🌧️'],
  65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌧️'],
  67: ['Heavy freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'],
  73: ['Snow', '🌨️'],
  75: ['Heavy snow', '❄️'],
  77: ['Snow grains', '🌨️'],
  80: ['Light showers', '🌦️'],
  81: ['Showers', '🌧️'],
  82: ['Violent showers', '⛈️'],
  85: ['Snow showers', '🌨️'],
  86: ['Heavy snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'],
  96: ['Thunderstorm, hail', '⛈️'],
  99: ['Thunderstorm, heavy hail', '⛈️'],
};

export function describeWeatherCode(code) {
  const hit = WMO[code];
  return hit ? { label: hit[0], icon: hit[1] } : { label: 'Unknown', icon: '🌡️' };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compassPoint(deg) {
  if (deg == null || !Number.isFinite(Number(deg))) return '';
  const i = Math.round((((Number(deg) % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i];
}

// "2026-10-21" -> "Today" / "Tomorrow" / "Fri, Oct 23". Parsed as a plain
// calendar date so the label can't slide a day across a UTC boundary.
export function dayLabel(dateStr, index) {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// "2026-10-21T07:12" -> "7:12 AM". Open-Meteo returns local wall time
// for the requested timezone, so read the digits rather than a Date.
export function clockLabel(isoLocal) {
  const m = /T(\d{2}):(\d{2})/.exec(String(isoLocal || ''));
  if (!m) return '';
  let h = Number(m[1]);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

const round = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const two = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);

// Turns Open-Meteo's column-oriented response into one object per day.
export function parseForecast(json) {
  const d = json?.daily;
  if (!d || !Array.isArray(d.time)) return { current: null, days: [] };
  const days = d.time.map((date, i) => {
    const { label, icon } = describeWeatherCode(d.weather_code?.[i]);
    return {
      date,
      label: dayLabel(date, i),
      condition: label,
      icon,
      high: round(d.temperature_2m_max?.[i]),
      low: round(d.temperature_2m_min?.[i]),
      feelsHigh: round(d.apparent_temperature_max?.[i]),
      feelsLow: round(d.apparent_temperature_min?.[i]),
      precipIn: two(d.precipitation_sum?.[i]),
      precipChance: round(d.precipitation_probability_max?.[i]),
      snowIn: two(d.snowfall_sum?.[i]),
      windMph: round(d.wind_speed_10m_max?.[i]),
      gustMph: round(d.wind_gusts_10m_max?.[i]),
      windDir: compassPoint(d.wind_direction_10m_dominant?.[i]),
      uv: round(d.uv_index_max?.[i]),
      sunrise: clockLabel(d.sunrise?.[i]),
      sunset: clockLabel(d.sunset?.[i]),
    };
  });
  const c = json.current;
  const current = c ? {
    temp: round(c.temperature_2m),
    feels: round(c.apparent_temperature),
    humidity: round(c.relative_humidity_2m),
    windMph: round(c.wind_speed_10m),
    windDir: compassPoint(c.wind_direction_10m),
    gustMph: round(c.wind_gusts_10m),
    ...(() => { const { label, icon } = describeWeatherCode(c.weather_code); return { condition: label, icon }; })(),
  } : null;
  return { current, days };
}
