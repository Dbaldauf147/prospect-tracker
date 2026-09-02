// Per-country indicative commercial-sector electric and natural gas
// prices, used as a rate fallback when no US state rate resolves AND
// the site doesn't carry an actual cost on the upload. Numbers come
// directly from the user's reference table.
//
// Electricity is stored in USD/kWh — drops straight into the existing
// `electricRate` slot (also $/kWh). Natural gas is stored as the
// user provided it (USD per kWh-equivalent), so callers that want a
// $/therm rate must multiply by THERMS_PER_KWH_FACTOR (29.3001 kWh
// per therm) before substituting into the existing `gasRate` slot
// — see `countryGasRatePerTherm` below.

import { countryNameFromIso3 } from './countryIso3.js';

export const COUNTRY_RATES = {
  // Sub-Saharan Africa
  'Angola':                            { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.013, gasUsdPerKwh: null },
  'Benin':                             { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.182, gasUsdPerKwh: null },
  'Botswana':                          { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.090, gasUsdPerKwh: null },
  'Burkina Faso':                      { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.210, gasUsdPerKwh: null },
  'Burundi':                           { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.077, gasUsdPerKwh: null },
  'Cameroon':                          { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.080, gasUsdPerKwh: null },
  'Central African Republic':          { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.296, gasUsdPerKwh: null },
  'Chad':                              { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.200, gasUsdPerKwh: null },
  'Democratic Republic of the Congo':  { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.060, gasUsdPerKwh: null },
  'Djibouti':                          { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.243, gasUsdPerKwh: null },
  'Equatorial Guinea':                 { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.149, gasUsdPerKwh: null },
  'Eritrea':                           { region: 'Sub-Saharan Africa', electricUsdPerKwh: null,  gasUsdPerKwh: null },
  'Eswatini':                          { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.120, gasUsdPerKwh: null },
  'Ethiopia':                          { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.010, gasUsdPerKwh: null },
  'Gabon':                             { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.200, gasUsdPerKwh: null },
  'Gambia':                            { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.225, gasUsdPerKwh: null },
  'Ghana':                             { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.130, gasUsdPerKwh: null },
  'Guinea':                            { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.111, gasUsdPerKwh: null },
  'Guinea-Bissau':                     { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.265, gasUsdPerKwh: null },
  'Ivory Coast':                       { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.130, gasUsdPerKwh: null },
  'Kenya':                             { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.220, gasUsdPerKwh: null },
  'Lesotho':                           { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.100, gasUsdPerKwh: null },
  'Liberia':                           { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.353, gasUsdPerKwh: null },
  'Madagascar':                        { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.130, gasUsdPerKwh: null },
  'Malawi':                            { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.090, gasUsdPerKwh: null },
  'Mali':                              { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.220, gasUsdPerKwh: null },
  'Mauritania':                        { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.122, gasUsdPerKwh: null },
  'Mozambique':                        { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.130, gasUsdPerKwh: null },
  'Namibia':                           { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.140, gasUsdPerKwh: null },
  'Niger':                             { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.193, gasUsdPerKwh: null },
  'Nigeria':                           { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.040, gasUsdPerKwh: 0.045 },
  'Republic of the Congo':             { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.149, gasUsdPerKwh: null },
  'Rwanda':                            { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.200, gasUsdPerKwh: null },
  'Senegal':                           { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.180, gasUsdPerKwh: null },
  'Sierra Leone':                      { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.230, gasUsdPerKwh: null },
  'Somalia':                           { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.491, gasUsdPerKwh: null },
  'South Africa':                      { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.190, gasUsdPerKwh: null },
  'South Sudan':                       { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.111, gasUsdPerKwh: null },
  'Tanzania':                          { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.090, gasUsdPerKwh: null },
  'Togo':                              { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.190, gasUsdPerKwh: null },
  'Uganda':                            { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.170, gasUsdPerKwh: null },
  'Zambia':                            { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.020, gasUsdPerKwh: null },
  'Zimbabwe':                          { region: 'Sub-Saharan Africa', electricUsdPerKwh: 0.021, gasUsdPerKwh: null },
  // Caribbean
  'Cuba':                              { region: 'Caribbean', electricUsdPerKwh: 0.020, gasUsdPerKwh: null },
  'Dominican Republic':                { region: 'Caribbean', electricUsdPerKwh: 0.120, gasUsdPerKwh: null },
  'Haiti':                             { region: 'Caribbean', electricUsdPerKwh: 0.395, gasUsdPerKwh: null },
  'Jamaica':                           { region: 'Caribbean', electricUsdPerKwh: 0.280, gasUsdPerKwh: null },
  // Central America
  'Belize':                            { region: 'Central America', electricUsdPerKwh: 0.220, gasUsdPerKwh: null },
  'Costa Rica':                        { region: 'Central America', electricUsdPerKwh: 0.170, gasUsdPerKwh: null },
  'El Salvador':                       { region: 'Central America', electricUsdPerKwh: 0.250, gasUsdPerKwh: null },
  'Guatemala':                         { region: 'Central America', electricUsdPerKwh: 0.290, gasUsdPerKwh: null },
  'Honduras':                          { region: 'Central America', electricUsdPerKwh: 0.240, gasUsdPerKwh: null },
  'Nicaragua':                         { region: 'Central America', electricUsdPerKwh: 0.180, gasUsdPerKwh: null },
  'Panama':                            { region: 'Central America', electricUsdPerKwh: 0.170, gasUsdPerKwh: null },
  // Central Asia
  'Afghanistan':                       { region: 'Central Asia', electricUsdPerKwh: 0.050, gasUsdPerKwh: null },
  'Kazakhstan':                        { region: 'Central Asia', electricUsdPerKwh: 0.060, gasUsdPerKwh: 0.025 },
  'Kyrgyzstan':                        { region: 'Central Asia', electricUsdPerKwh: 0.017, gasUsdPerKwh: 0.040 },
  'Tajikistan':                        { region: 'Central Asia', electricUsdPerKwh: 0.029, gasUsdPerKwh: null },
  'Turkmenistan':                      { region: 'Central Asia', electricUsdPerKwh: null,  gasUsdPerKwh: null },
  'Uzbekistan':                        { region: 'Central Asia', electricUsdPerKwh: 0.040, gasUsdPerKwh: 0.020 },
  // East Asia
  'China':                             { region: 'East Asia', electricUsdPerKwh: 0.080, gasUsdPerKwh: 0.045 },
  'Japan':                             { region: 'East Asia', electricUsdPerKwh: 0.230, gasUsdPerKwh: 0.175 },
  'Mongolia':                          { region: 'East Asia', electricUsdPerKwh: 0.041, gasUsdPerKwh: null },
  'North Korea':                       { region: 'East Asia', electricUsdPerKwh: null,  gasUsdPerKwh: null },
  'South Korea':                       { region: 'East Asia', electricUsdPerKwh: 0.130, gasUsdPerKwh: 0.075 },
  'Taiwan':                            { region: 'East Asia', electricUsdPerKwh: 0.100, gasUsdPerKwh: 0.060 },
  // Europe
  'Albania':                           { region: 'Europe', electricUsdPerKwh: 0.120, gasUsdPerKwh: null },
  'Austria':                           { region: 'Europe', electricUsdPerKwh: 0.340, gasUsdPerKwh: 0.116 },
  'Belarus':                           { region: 'Europe', electricUsdPerKwh: 0.080, gasUsdPerKwh: 0.006 },
  'Belgium':                           { region: 'Europe', electricUsdPerKwh: 0.400, gasUsdPerKwh: 0.124 },
  'Bosnia and Herzegovina':            { region: 'Europe', electricUsdPerKwh: 0.100, gasUsdPerKwh: 0.055 },
  'Bulgaria':                          { region: 'Europe', electricUsdPerKwh: 0.150, gasUsdPerKwh: 0.075 },
  'Croatia':                           { region: 'Europe', electricUsdPerKwh: 0.170, gasUsdPerKwh: 0.059 },
  'Cyprus':                            { region: 'Europe', electricUsdPerKwh: 0.340, gasUsdPerKwh: null },
  'Czechia':                           { region: 'Europe', electricUsdPerKwh: 0.350, gasUsdPerKwh: 0.108 },
  'Denmark':                           { region: 'Europe', electricUsdPerKwh: 0.360, gasUsdPerKwh: 0.141 },
  'Estonia':                           { region: 'Europe', electricUsdPerKwh: 0.290, gasUsdPerKwh: 0.092 },
  'Finland':                           { region: 'Europe', electricUsdPerKwh: 0.180, gasUsdPerKwh: null },
  'France':                            { region: 'Europe', electricUsdPerKwh: 0.280, gasUsdPerKwh: 0.119 },
  'Germany':                           { region: 'Europe', electricUsdPerKwh: 0.400, gasUsdPerKwh: 0.144 },
  'Greece':                            { region: 'Europe', electricUsdPerKwh: 0.250, gasUsdPerKwh: 0.094 },
  'Hungary':                           { region: 'Europe', electricUsdPerKwh: 0.110, gasUsdPerKwh: 0.037 },
  'Iceland':                           { region: 'Europe', electricUsdPerKwh: 0.170, gasUsdPerKwh: null },
  'Ireland':                           { region: 'Europe', electricUsdPerKwh: 0.440, gasUsdPerKwh: 0.137 },
  'Italy':                             { region: 'Europe', electricUsdPerKwh: 0.420, gasUsdPerKwh: 0.160 },
  'Kosovo':                            { region: 'Europe', electricUsdPerKwh: 0.085, gasUsdPerKwh: null },
  'Latvia':                            { region: 'Europe', electricUsdPerKwh: 0.280, gasUsdPerKwh: 0.099 },
  'Lithuania':                         { region: 'Europe', electricUsdPerKwh: 0.270, gasUsdPerKwh: 0.106 },
  'Luxembourg':                        { region: 'Europe', electricUsdPerKwh: 0.250, gasUsdPerKwh: 0.105 },
  'Malta':                             { region: 'Europe', electricUsdPerKwh: 0.150, gasUsdPerKwh: null },
  'Moldova':                           { region: 'Europe', electricUsdPerKwh: 0.170, gasUsdPerKwh: 0.085 },
  'Montenegro':                        { region: 'Europe', electricUsdPerKwh: 0.108, gasUsdPerKwh: null },
  'Netherlands':                       { region: 'Europe', electricUsdPerKwh: 0.290, gasUsdPerKwh: 0.186 },
  'North Macedonia':                   { region: 'Europe', electricUsdPerKwh: 0.130, gasUsdPerKwh: 0.068 },
  'Norway':                            { region: 'Europe', electricUsdPerKwh: 0.150, gasUsdPerKwh: 0.165 },
  'Poland':                            { region: 'Europe', electricUsdPerKwh: 0.230, gasUsdPerKwh: 0.071 },
  'Portugal':                          { region: 'Europe', electricUsdPerKwh: 0.230, gasUsdPerKwh: 0.142 },
  'Romania':                           { region: 'Europe', electricUsdPerKwh: 0.190, gasUsdPerKwh: 0.061 },
  'Serbia':                            { region: 'Europe', electricUsdPerKwh: 0.130, gasUsdPerKwh: 0.067 },
  'Slovakia':                          { region: 'Europe', electricUsdPerKwh: 0.210, gasUsdPerKwh: 0.075 },
  'Slovenia':                          { region: 'Europe', electricUsdPerKwh: 0.230, gasUsdPerKwh: 0.105 },
  'Spain':                             { region: 'Europe', electricUsdPerKwh: 0.250, gasUsdPerKwh: 0.122 },
  'Sweden':                            { region: 'Europe', electricUsdPerKwh: 0.230, gasUsdPerKwh: 0.226 },
  'Switzerland':                       { region: 'Europe', electricUsdPerKwh: 0.360, gasUsdPerKwh: 0.158 },
  'Ukraine':                           { region: 'Europe', electricUsdPerKwh: 0.080, gasUsdPerKwh: 0.030 },
  'United Kingdom':                    { region: 'Europe', electricUsdPerKwh: 0.400, gasUsdPerKwh: 0.114 },
  // Caucasus / Russia (the user's table groups Turkey here)
  'Armenia':                           { region: 'Caucasus/Russia', electricUsdPerKwh: 0.110, gasUsdPerKwh: 0.105 },
  'Azerbaijan':                        { region: 'Caucasus/Russia', electricUsdPerKwh: 0.050, gasUsdPerKwh: 0.014 },
  'Georgia':                           { region: 'Caucasus/Russia', electricUsdPerKwh: 0.070, gasUsdPerKwh: 0.060 },
  'Russia':                            { region: 'Caucasus/Russia', electricUsdPerKwh: 0.070, gasUsdPerKwh: 0.008 },
  'Turkey':                            { region: 'Caucasus/Russia', electricUsdPerKwh: 0.070, gasUsdPerKwh: 0.062 },
  // Middle East
  'Iran':                              { region: 'Middle East', electricUsdPerKwh: 0.005, gasUsdPerKwh: 0.001 },
  'Iraq':                              { region: 'Middle East', electricUsdPerKwh: 0.010, gasUsdPerKwh: null },
  'Israel':                            { region: 'Middle East', electricUsdPerKwh: 0.180, gasUsdPerKwh: null },
  'Jordan':                            { region: 'Middle East', electricUsdPerKwh: 0.090, gasUsdPerKwh: null },
  'Kuwait':                            { region: 'Middle East', electricUsdPerKwh: 0.040, gasUsdPerKwh: null },
  'Lebanon':                           { region: 'Middle East', electricUsdPerKwh: 0.100, gasUsdPerKwh: null },
  'Oman':                              { region: 'Middle East', electricUsdPerKwh: 0.030, gasUsdPerKwh: 0.030 },
  'Qatar':                             { region: 'Middle East', electricUsdPerKwh: 0.030, gasUsdPerKwh: 0.015 },
  'Saudi Arabia':                      { region: 'Middle East', electricUsdPerKwh: 0.050, gasUsdPerKwh: null },
  'Syria':                             { region: 'Middle East', electricUsdPerKwh: 0.010, gasUsdPerKwh: null },
  'United Arab Emirates':              { region: 'Middle East', electricUsdPerKwh: 0.080, gasUsdPerKwh: 0.045 },
  'Yemen':                             { region: 'Middle East', electricUsdPerKwh: 0.036, gasUsdPerKwh: null },
  // North Africa
  'Algeria':                           { region: 'North Africa', electricUsdPerKwh: 0.040, gasUsdPerKwh: 0.003 },
  'Egypt':                             { region: 'North Africa', electricUsdPerKwh: 0.020, gasUsdPerKwh: 0.005 },
  'Libya':                             { region: 'North Africa', electricUsdPerKwh: 0.007, gasUsdPerKwh: 0.005 },
  'Morocco':                           { region: 'North Africa', electricUsdPerKwh: 0.120, gasUsdPerKwh: null },
  'Sudan':                             { region: 'North Africa', electricUsdPerKwh: 0.010, gasUsdPerKwh: null },
  'Tunisia':                           { region: 'North Africa', electricUsdPerKwh: 0.070, gasUsdPerKwh: 0.045 },
  // North America
  'Canada':                            { region: 'North America', electricUsdPerKwh: 0.120, gasUsdPerKwh: 0.040 },
  'Greenland':                         { region: 'North America', electricUsdPerKwh: 0.250, gasUsdPerKwh: null },
  'Mexico':                            { region: 'North America', electricUsdPerKwh: 0.110, gasUsdPerKwh: 0.045 },
  'United States':                     { region: 'North America', electricUsdPerKwh: 0.180, gasUsdPerKwh: 0.050 },
  // Oceania
  'Australia':                         { region: 'Oceania', electricUsdPerKwh: 0.260, gasUsdPerKwh: 0.130 },
  'New Zealand':                       { region: 'Oceania', electricUsdPerKwh: 0.210, gasUsdPerKwh: 0.110 },
  'Papua New Guinea':                  { region: 'Oceania', electricUsdPerKwh: 0.318, gasUsdPerKwh: null },
  // South America
  'Argentina':                         { region: 'South America', electricUsdPerKwh: 0.080, gasUsdPerKwh: 0.030 },
  'Bolivia':                           { region: 'South America', electricUsdPerKwh: 0.072, gasUsdPerKwh: 0.010 },
  'Brazil':                            { region: 'South America', electricUsdPerKwh: 0.160, gasUsdPerKwh: 0.207 },
  'Chile':                             { region: 'South America', electricUsdPerKwh: 0.210, gasUsdPerKwh: 0.085 },
  'Colombia':                          { region: 'South America', electricUsdPerKwh: 0.200, gasUsdPerKwh: 0.055 },
  'Ecuador':                           { region: 'South America', electricUsdPerKwh: 0.100, gasUsdPerKwh: null },
  'Guyana':                            { region: 'South America', electricUsdPerKwh: 0.237, gasUsdPerKwh: null },
  'Paraguay':                          { region: 'South America', electricUsdPerKwh: 0.050, gasUsdPerKwh: null },
  'Peru':                              { region: 'South America', electricUsdPerKwh: 0.190, gasUsdPerKwh: 0.040 },
  'Suriname':                          { region: 'South America', electricUsdPerKwh: 0.050, gasUsdPerKwh: null },
  'Uruguay':                           { region: 'South America', electricUsdPerKwh: 0.250, gasUsdPerKwh: 0.150 },
  'Venezuela':                         { region: 'South America', electricUsdPerKwh: 0.070, gasUsdPerKwh: 0.005 },
  // South Asia
  'Bangladesh':                        { region: 'South Asia', electricUsdPerKwh: 0.060, gasUsdPerKwh: 0.010 },
  'Bhutan':                            { region: 'South Asia', electricUsdPerKwh: 0.010, gasUsdPerKwh: null },
  'India':                             { region: 'South Asia', electricUsdPerKwh: 0.080, gasUsdPerKwh: 0.040 },
  'Nepal':                             { region: 'South Asia', electricUsdPerKwh: 0.040, gasUsdPerKwh: null },
  'Pakistan':                          { region: 'South Asia', electricUsdPerKwh: 0.070, gasUsdPerKwh: 0.020 },
  'Sri Lanka':                         { region: 'South Asia', electricUsdPerKwh: 0.120, gasUsdPerKwh: null },
  // Southeast Asia
  'Brunei':                            { region: 'Southeast Asia', electricUsdPerKwh: 0.072, gasUsdPerKwh: 0.025 },
  'Cambodia':                          { region: 'Southeast Asia', electricUsdPerKwh: 0.150, gasUsdPerKwh: null },
  'East Timor':                        { region: 'Southeast Asia', electricUsdPerKwh: 0.241, gasUsdPerKwh: null },
  'Indonesia':                         { region: 'Southeast Asia', electricUsdPerKwh: 0.090, gasUsdPerKwh: 0.030 },
  'Laos':                              { region: 'Southeast Asia', electricUsdPerKwh: 0.030, gasUsdPerKwh: null },
  'Malaysia':                          { region: 'Southeast Asia', electricUsdPerKwh: 0.050, gasUsdPerKwh: 0.040 },
  'Myanmar':                           { region: 'Southeast Asia', electricUsdPerKwh: 0.030, gasUsdPerKwh: null },
  'Philippines':                       { region: 'Southeast Asia', electricUsdPerKwh: 0.200, gasUsdPerKwh: null },
  'Singapore':                         { region: 'Southeast Asia', electricUsdPerKwh: 0.230, gasUsdPerKwh: 0.190 },
  'Thailand':                          { region: 'Southeast Asia', electricUsdPerKwh: 0.130, gasUsdPerKwh: 0.040 },
  'Vietnam':                           { region: 'Southeast Asia', electricUsdPerKwh: 0.080, gasUsdPerKwh: 0.060 },
};

// Energy-content of a U.S. natural-gas therm in kWh-equivalent. Used
// to convert the country gas rate (priced per kWh) into the $/therm
// shape the existing stateRate('gas') slot uses, so country rates
// drop into the same math without rewriting the cost helpers.
export const KWH_PER_THERM = 29.3001;

// Strip common formatting + punctuation so "U.S.", "u s a", "Republic
// of Korea" canonicalize cleanly against the table keys.
function canonicalKey(raw) {
  return String(raw).toLowerCase().replace(/[.,()]/g, '').replace(/\s+/g, ' ').trim();
}

const NAME_ALIASES = {
  'usa':                                 'United States',
  'us':                                  'United States',
  'u s':                                 'United States',
  'u s a':                               'United States',
  'united states of america':            'United States',
  'america':                             'United States',
  'uk':                                  'United Kingdom',
  'u k':                                 'United Kingdom',
  'great britain':                       'United Kingdom',
  'britain':                             'United Kingdom',
  'england':                             'United Kingdom',
  'scotland':                            'United Kingdom',
  'wales':                               'United Kingdom',
  'northern ireland':                    'United Kingdom',
  'uae':                                 'United Arab Emirates',
  'u a e':                               'United Arab Emirates',
  'emirates':                            'United Arab Emirates',
  'czech republic':                      'Czechia',
  'cote d ivoire':                       'Ivory Coast',
  "cote d'ivoire":                       'Ivory Coast',
  "côte d'ivoire":                       'Ivory Coast',
  'timor leste':                         'East Timor',
  'timor-leste':                         'East Timor',
  'south korea':                         'South Korea',
  'republic of korea':                   'South Korea',
  'korea south':                         'South Korea',
  'korea, republic of':                  'South Korea',
  'north korea':                         'North Korea',
  "democratic people's republic of korea": 'North Korea',
  'korea north':                         'North Korea',
  'korea, democratic peoples republic of': 'North Korea',
  'congo democratic republic of the':    'Democratic Republic of the Congo',
  'congo, the democratic republic of the': 'Democratic Republic of the Congo',
  'dr congo':                            'Democratic Republic of the Congo',
  'drc':                                 'Democratic Republic of the Congo',
  'congo kinshasa':                      'Democratic Republic of the Congo',
  'congo brazzaville':                   'Republic of the Congo',
  'congo':                               'Republic of the Congo',
  'russian federation':                  'Russia',
  'syrian arab republic':                'Syria',
  'iran islamic republic of':            'Iran',
  'lao':                                 'Laos',
  "lao people's democratic republic":    'Laos',
  'viet nam':                            'Vietnam',
  'burma':                               'Myanmar',
  'macedonia':                           'North Macedonia',
  'swaziland':                           'Eswatini',
  'holland':                             'Netherlands',
  'the netherlands':                     'Netherlands',
};

export function normalizeCountryRateName(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (COUNTRY_RATES[trimmed]) return trimmed;
  const key = canonicalKey(trimmed);
  if (!key) return null;
  const aliased = NAME_ALIASES[key];
  if (aliased && COUNTRY_RATES[aliased]) return aliased;
  // ISO 3166-1 alpha-3 ("CAN", "MEX", "TUN"), same as the deregulation
  // table — the two are keyed by the identical country list, so a code
  // that resolves a dereg status also resolves an indicative rate.
  const iso3 = countryNameFromIso3(trimmed);
  if (iso3 && COUNTRY_RATES[iso3]) return iso3;
  for (const name of Object.keys(COUNTRY_RATES)) {
    if (canonicalKey(name) === key) return name;
  }
  return null;
}

export function countryRates(rawCountry) {
  const name = normalizeCountryName(rawCountry);
  if (!name) return null;
  return COUNTRY_RATES[name];
}

// Convenience: electric rate in $/kWh, or null when the country isn't
// on the reference list / has no posted rate.
export function countryElectricRate(rawCountry) {
  const r = countryRates(rawCountry);
  return r?.electricUsdPerKwh ?? null;
}

// Gas rate translated into $/therm so it drops straight into the
// existing `gasRate` slot the cost helpers consume. Returns null when
// the country has no gas rate posted.
export function countryGasRatePerTherm(rawCountry) {
  const r = countryRates(rawCountry);
  if (!r || r.gasUsdPerKwh == null) return null;
  return r.gasUsdPerKwh * KWH_PER_THERM;
}

// Internal alias so the lookup uses the same canonicalization as the
// other country reference tables.
function normalizeCountryName(raw) {
  return normalizeCountryRateName(raw);
}
