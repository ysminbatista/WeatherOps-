import { HttpError } from './routes.js';
import { envelope, getLatestSuccessfulRun, localDate } from './snapshot.js';

export const MAX_HISTORY_DAYS = 30;
/** Coletas esperadas por dia (a cada 30 min). */
export const EXPECTED_RUNS_PER_DAY = 48;
/** Máxima distância entre o snapshot escolhido e o instante "24 h antes". */
const MAX_SNAPSHOT_DISTANCE = '12 hours';

const num = (v) => (v == null ? null : Number(v));
const round1 = (v) => Math.round(v * 10) / 10;

/** Cobertura (0–100) = coletas com sucesso no dia anterior ÷ 48, limitada a 100. */
export function coveragePct(runs) {
  return Math.min(100, Math.round((runs / EXPECTED_RUNS_PER_DAY) * 100));
}

/** observado − previsto, em 1 casa decimal; nulo se faltar um dos lados. */
export function difference(forecast, observed) {
  if (!forecast || !observed) return null;
  const d = (k) => (forecast[k] == null || observed[k] == null ? null : round1(observed[k] - forecast[k]));
  return {
    temperature_max: d('temperature_max'),
    temperature_min: d('temperature_min'),
    precipitation_sum: d('precipitation_sum'),
    wind_speed_max: d('wind_speed_max'),
  };
}

/**
 * Previsto D-1 × observado por dia, do dia anterior a hoje para trás.
 * Previsto = daily_forecast do snapshot com sucesso mais próximo de 24 h antes do início do dia
 * (isto é, de 00:00 do dia anterior, no fuso do local), a no máximo 12 h de distância.
 * Observado = observed_daily (reanálise). Dia sem observado vem como `unavailable`.
 */
export async function history(pool, rawId, rawDays, now) {
  if (!/^\d+$/.test(rawId)) throw new HttpError(400, 'id de local inválido');
  const { rows: locs } = await pool.query(
    'SELECT id, name, timezone FROM locations WHERE id = $1 AND active', [Number(rawId)]);
  const location = locs[0];
  if (!location) throw new HttpError(404, 'local não encontrado');

  let days = MAX_HISTORY_DAYS;
  if (rawDays != null) {
    if (!/^\d+$/.test(rawDays) || Number(rawDays) < 1) throw new HttpError(400, 'days inválido');
    days = Math.min(Number(rawDays), MAX_HISTORY_DAYS);
  }

  const run = await getLatestSuccessfulRun(pool, location.id);
  const base = envelope(location, run, now);
  const today = localDate(now, location.timezone);

  const { rows } = await pool.query(
    `WITH days AS (
       SELECT d::date AS day,
              ((d::date - 1)::timestamp AT TIME ZONE $2) AS ref
         FROM generate_series($3::date - $4::int, $3::date - 1, interval '1 day') d
     )
     SELECT days.day::text AS date,
            f.started_at AS forecast_run_at,
            f.temperature_max AS f_tmax, f.temperature_min AS f_tmin,
            f.precipitation_sum AS f_rain, f.wind_speed_max AS f_wind,
            o.temperature_max AS o_tmax, o.temperature_min AS o_tmin,
            o.precipitation_sum AS o_rain, o.wind_speed_max AS o_wind,
            (o.location_id IS NOT NULL) AS has_observed,
            (SELECT count(*)::int FROM fetch_runs c
              WHERE c.location_id = $1 AND c.status = 'success'
                AND c.started_at >= days.ref AND c.started_at < days.ref + interval '24 hours') AS runs
       FROM days
       LEFT JOIN LATERAL (
         SELECT fr.started_at, df.temperature_max, df.temperature_min, df.precipitation_sum, df.wind_speed_max
           FROM fetch_runs fr
           JOIN daily_forecast df ON df.fetch_run_id = fr.id AND df.forecast_date = days.day
          WHERE fr.location_id = $1 AND fr.status = 'success'
            AND fr.started_at BETWEEN days.ref - interval '${MAX_SNAPSHOT_DISTANCE}' AND days.ref + interval '${MAX_SNAPSHOT_DISTANCE}'
          ORDER BY abs(extract(epoch FROM fr.started_at - days.ref))
          LIMIT 1
       ) f ON true
       LEFT JOIN observed_daily o ON o.location_id = $1 AND o.date = days.day
      ORDER BY days.day DESC`,
    [location.id, location.timezone, today, days]);

  return {
    ...base,
    days,
    observed_source: 'reanalysis',
    history: rows.map((r) => {
      const forecast = !r.forecast_run_at ? null : {
        temperature_max: num(r.f_tmax), temperature_min: num(r.f_tmin),
        precipitation_sum: num(r.f_rain), wind_speed_max: num(r.f_wind),
      };
      const observed = r.has_observed ? {
        temperature_max: num(r.o_tmax), temperature_min: num(r.o_tmin),
        precipitation_sum: num(r.o_rain), wind_speed_max: num(r.o_wind),
      } : null;
      return {
        date: r.date,
        forecast,
        observed,
        observed_status: observed ? 'available' : 'unavailable',
        difference: difference(forecast, observed),
        coverage_pct: coveragePct(r.runs),
      };
    }),
  };
}
