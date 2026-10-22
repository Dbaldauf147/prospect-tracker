import { useEffect, useState } from 'react';
import styles from './DailyWeatherPopup.module.css';
import { WEATHER_LOCATION, weatherUrl, parseForecast } from '../../utils/dailyWeather';

// The first-thing-in-the-morning forecast: today plus the next two days for
// Brooklyn. App decides when it opens (once per local day); this only
// fetches and draws.
export function DailyWeatherPopup({ open, onClose }) {
  const [state, setState] = useState({ status: 'loading', data: null });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(weatherUrl())
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(json => {
        if (cancelled) return;
        const data = parseForecast(json);
        setState(data.days.length ? { status: 'ok', data } : { status: 'error', data: null });
      })
      .catch(() => { if (!cancelled) setState({ status: 'error', data: null }); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const { status, data } = state;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Weather forecast" onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.head}>
          <div>
            <div className={styles.title}>Good morning! Here's the weather</div>
            <div className={styles.sub}>{WEATHER_LOCATION.name} · {today}</div>
          </div>
          {status === 'ok' && data.current && (
            <div className={styles.now} title="Current conditions">
              <span className={styles.nowIcon}>{data.current.icon}</span>
              <div>
                <div className={styles.nowTemps}>
                  <span className={styles.nowTemp}>{data.current.temp}°F</span>
                  {data.current.feels != null && (
                    <span className={styles.nowTemp}>
                      <span className={styles.nowFeelsLabel}>Feels</span> {data.current.feels}°F
                    </span>
                  )}
                </div>
                <div className={styles.nowMeta}>
                  Now: {data.current.condition}
                  {data.current.windMph != null && (
                    <>
                      {' · '}Wind {data.current.windMph} mph{data.current.windDir ? ` ${data.current.windDir}` : ''}
                      {data.current.gustMph != null && `, gusts ${data.current.gustMph} mph`}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className={styles.body}>
          {status === 'loading' && <div className={styles.msg}>Loading forecast...</div>}
          {status === 'error' && (
            <div className={styles.msg}>Couldn't load the forecast right now. Try again later.</div>
          )}
          {status === 'ok' && (
            <div className={styles.days}>
              {data.days.map(day => (
                <div key={day.date} className={styles.day}>
                  <div className={styles.dayName}>{day.label}</div>
                  <div className={styles.dayIcon} aria-hidden="true">{day.icon}</div>
                  <div className={styles.cond}>{day.condition}</div>
                  <div className={styles.temps}>
                    <span className={styles.hi}>{day.high}°</span>
                    <span className={styles.lo}>{day.low}°</span>
                  </div>
                  <div className={styles.feels}>Feels {day.feelsLow}° to {day.feelsHigh}°</div>
                  <dl className={styles.stats}>
                    <dt>Precip</dt>
                    <dd>{day.precipChance ?? 0}% · {day.precipIn ?? 0}"</dd>
                    {day.snowIn > 0 && (<><dt>Snow</dt><dd>{day.snowIn}"</dd></>)}
                    <dt>Wind</dt>
                    <dd>{day.windMph} mph {day.windDir}</dd>
                    <dt>Gusts</dt>
                    <dd>{day.gustMph} mph</dd>
                    <dt>UV</dt>
                    <dd>{day.uv}</dd>
                    <dt>Sun</dt>
                    <dd>{day.sunrise} / {day.sunset}</dd>
                  </dl>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.foot}>
          <span className={styles.credit}>
            Forecast: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
          </span>
          <button type="button" className={styles.btn} onClick={onClose} autoFocus>Got it</button>
        </div>
      </div>
    </div>
  );
}
