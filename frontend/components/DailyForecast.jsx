import { describeRiskReasons, fmtDayLabel, fmtKmh, fmtMm, fmtPct, fmtTemp } from '../lib/format.js';
import { weatherInfo } from '../lib/wmo.js';
import { S } from '../lib/strings.js';

function DayCard({ day, isToday }) {
  const { weekday, day: dd } = fmtDayLabel(day.date);
  const info = weatherInfo(day.weather_code);
  const reasons = day.is_risk ? describeRiskReasons(day) : [];
  return (
    <li className={`day${day.is_risk ? ' day-risk' : ''}`}>
      <div className="day-head">
        <strong>{isToday ? S.daily.today : weekday}</strong>
        <span>{dd}</span>
      </div>
      <div className="day-icon" role="img" aria-label={info.description}>{info.icon}</div>
      <div className="day-desc">{info.description}</div>
      <dl>
        <div><dt>{S.daily.min}</dt><dd>{fmtTemp(day.temperature_min)}</dd></div>
        <div><dt>{S.daily.max}</dt><dd>{fmtTemp(day.temperature_max)}</dd></div>
        <div><dt>{S.daily.rain}</dt><dd>{fmtMm(day.precipitation_sum)}</dd></div>
        <div><dt>{S.daily.prob}</dt><dd>{fmtPct(day.precipitation_probability_max)}</dd></div>
        <div><dt>{S.daily.wind}</dt><dd>{fmtKmh(day.wind_speed_max)}</dd></div>
      </dl>
      {reasons.length > 0 && (
        <div className="risk">
          <span className="risk-badge">{S.daily.riskBadge}</span>
          <ul>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
    </li>
  );
}

export default function DailyForecast({ daily }) {
  if (!daily.length) return null;
  return (
    <section>
      <h2>{S.daily.title}</h2>
      <ol className="days">
        {daily.map((d, i) => <DayCard key={d.date} day={d} isToday={i === 0} />)}
      </ol>
    </section>
  );
}
