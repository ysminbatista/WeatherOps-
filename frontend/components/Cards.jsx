import { fmtNum, fmtKmh, fmtMm, fmtPct, fmtTemp } from '../lib/format.js';
import { weatherInfo } from '../lib/wmo.js';
import { S } from '../lib/strings.js';

function Card({ label, value, hint }) {
  return (
    <div className="card">
      <span className="card-label">{label}</span>
      <span className="card-value">{value}</span>
      {hint && <span className="card-hint">{hint}</span>}
    </div>
  );
}

export default function Cards({ summary }) {
  const { current, today, next_24h_max_precipitation_probability: rain24 } = summary;
  const cond = current ? weatherInfo(current.weather_code) : null;
  const minMax = today ? `${fmtNum(today.temperature_min)} / ${fmtTemp(today.temperature_max)}` : '—';
  return (
    <section className="cards" aria-label="Indicadores">
      <Card
        label={S.cards.temperature}
        value={fmtTemp(current?.temperature)}
        hint={cond && `${cond.icon} ${cond.description}`}
      />
      <Card label={S.cards.apparent} value={fmtTemp(current?.apparent_temperature)} />
      <Card label={S.cards.rain24h} value={fmtPct(rain24)} />
      <Card label={S.cards.precipToday} value={fmtMm(today?.precipitation_sum)} />
      <Card label={S.cards.windToday} value={fmtKmh(today?.wind_speed_max)} />
      <Card label={S.cards.minMax} value={minMax} />
    </section>
  );
}
