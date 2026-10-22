// Assertion tests for the morning weather popup's helpers. Plain Node, no
// test framework. Run:
//   node scripts/dailyWeather.test.mjs
import {
  weatherUrl, localDateKey, shouldShowWeather, describeWeatherCode,
  compassPoint, dayLabel, clockLabel, parseForecast,
} from '../src/utils/dailyWeather.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const url = new URL(weatherUrl());
eq(url.host, 'api.open-meteo.com', 'asks Open-Meteo');
eq(url.searchParams.get('forecast_days'), '3', 'three days, today included');
eq(url.searchParams.get('temperature_unit'), 'fahrenheit', 'Fahrenheit');
eq(url.searchParams.get('wind_speed_unit'), 'mph', 'mph');
eq(url.searchParams.get('timezone'), 'America/New_York', 'Brooklyn time');

// Once a day, keyed on the local calendar.
eq(localDateKey(new Date(2026, 9, 21, 23, 59)), '2026-10-21', 'late evening is still today');
eq(shouldShowWeather(undefined, '2026-10-21'), true, 'never seen -> show');
eq(shouldShowWeather('2026-10-21', '2026-10-21'), false, 'seen today -> stay down');
eq(shouldShowWeather('2026-10-20', '2026-10-21'), true, 'seen yesterday -> show');

eq(describeWeatherCode(63).label, 'Rain', 'WMO 63 is rain');
eq(describeWeatherCode(1234).label, 'Unknown', 'unknown codes do not throw');
eq(compassPoint(0), 'N', '0 deg is N');
eq(compassPoint(350), 'N', '350 deg rounds to N');
eq(compassPoint(225), 'SW', '225 deg is SW');
eq(compassPoint(null), '', 'missing direction is blank');
eq(dayLabel('2026-10-21', 0), 'Today', 'first day is Today');
eq(dayLabel('2026-10-22', 1), 'Tomorrow', 'second day is Tomorrow');
eq(dayLabel('2026-10-23', 2), 'Fri, Oct 23', 'third day is named');
eq(clockLabel('2026-10-21T07:12'), '7:12 AM', 'sunrise clock');
eq(clockLabel('2026-10-21T18:05'), '6:05 PM', 'sunset clock');
eq(clockLabel('2026-10-21T00:30'), '12:30 AM', 'midnight hour');

const parsed = parseForecast({
  current: { temperature_2m: 54.4, apparent_temperature: 51.6, relative_humidity_2m: 70, weather_code: 2, wind_speed_10m: 8.2, wind_direction_10m: 270, wind_gusts_10m: 17.6 },
  daily: {
    time: ['2026-10-21', '2026-10-22', '2026-10-23'],
    weather_code: [2, 61, 0],
    temperature_2m_max: [61.2, 57.8, 63],
    temperature_2m_min: [48.9, 50.1, 47],
    apparent_temperature_max: [59, 55, 62],
    apparent_temperature_min: [45, 47, 44],
    precipitation_sum: [0, 0.4321, 0],
    precipitation_probability_max: [10, 85, 0],
    snowfall_sum: [0, 0, 0],
    wind_speed_10m_max: [12.4, 18.6, 7],
    wind_gusts_10m_max: [22, 31.5, 14],
    wind_direction_10m_dominant: [270, 45, 180],
    uv_index_max: [3.6, 1.2, 4],
    sunrise: ['2026-10-21T07:12', '2026-10-22T07:13', '2026-10-23T07:14'],
    sunset: ['2026-10-21T18:05', '2026-10-22T18:04', '2026-10-23T18:02'],
  },
});
eq(parsed.days.length, 3, 'three day rows');
eq(parsed.days[1].condition, 'Light rain', 'tomorrow condition');
eq(parsed.days[1].precipIn, 0.43, 'precip rounded to hundredths');
eq(parsed.days[1].precipChance, 85, 'precip chance');
eq([parsed.days[0].high, parsed.days[0].low], [61, 49], 'highs and lows rounded');
eq(parsed.days[1].windDir, 'NE', 'dominant wind direction');
eq(parsed.days[1].gustMph, 32, 'gusts');
eq(parsed.current.temp, 54, 'current temp');
eq(parsed.current.windDir, 'W', 'current wind direction');
eq(parsed.current.gustMph, 18, 'current gusts');
eq(parsed.current.windMph, 8, 'current wind speed');
eq(parseForecast(null), { current: null, days: [] }, 'bad payload is empty, not a crash');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
