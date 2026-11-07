import { envelope, getLatestSuccessfulRun, isStale, localDate, toLocalIso } from './snapshot.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const num = (v) => (v == null ? null : Number(v));

async function findActiveLocation(pool, rawId) {
  if (!/^\d+$/.test(rawId)) throw new HttpError(400, 'id de local inválido');
  const { rows } = await pool.query(
    'SELECT id, name, timezone FROM locations WHERE id = $1 AND active', [Number(rawId)]);
  if (!rows[0]) throw new HttpError(404, 'local não encontrado');
  return rows[0];
}

export async function listLocations(pool) {
  const { rows } = await pool.query(
    'SELECT id, name, latitude::float8 AS latitude, longitude::float8 AS longitude, timezone FROM locations WHERE active ORDER BY id');
  return { locations: rows };
}

export async function summary(pool, rawId, now) {
  const location = await findActiveLocation(pool, rawId);
  const run = await getLatestSuccessfulRun(pool, location.id);
  const base = envelope(location, run, now);
  if (!run) return { ...base, current: null, next_24h_max_precipitation_probability: null, today: null };

  const [cur, next24, today] = await Promise.all([
    pool.query(
      `SELECT temperature_2m, apparent_temperature, weather_code
         FROM current_conditions WHERE fetch_run_id = $1 LIMIT 1`, [run.id]),
    // Da hora cheia em curso até agora + 24 h.
    pool.query(
      `SELECT max(precipitation_probability) AS max_prob
         FROM hourly_forecast
        WHERE fetch_run_id = $1
          AND forecast_time >= date_trunc('hour', $2::timestamptz)
          AND forecast_time <= $2::timestamptz + interval '24 hours'`, [run.id, now]),
    // Dia civil inteiro no fuso do local.
    pool.query(
      `SELECT precipitation_sum, wind_speed_max, temperature_min, temperature_max
         FROM daily_forecast WHERE fetch_run_id = $1 AND forecast_date = $2::date`,
      [run.id, localDate(now, location.timezone)]),
  ]);

  const c = cur.rows[0];
  const t = today.rows[0];
  return {
    ...base,
    current: c && {
      temperature: num(c.temperature_2m),
      apparent_temperature: num(c.apparent_temperature),
      weather_code: c.weather_code,
    },
    next_24h_max_precipitation_probability: next24.rows[0].max_prob,
    today: t && {
      precipitation_sum: num(t.precipitation_sum),
      wind_speed_max: num(t.wind_speed_max),
      temperature_min: num(t.temperature_min),
      temperature_max: num(t.temperature_max),
    },
  };
}

export async function hourly(pool, rawId, rawHours, now) {
  const location = await findActiveLocation(pool, rawId);
  let hours = 48;
  if (rawHours != null) {
    if (!/^\d+$/.test(rawHours) || Number(rawHours) < 1) throw new HttpError(400, 'hours inválido');
    hours = Math.min(Number(rawHours), 168);
  }
  const run = await getLatestSuccessfulRun(pool, location.id);
  const base = envelope(location, run, now);
  if (!run) return { ...base, hours, hourly: [] };

  const { rows } = await pool.query(
    `SELECT forecast_time, temperature_2m, apparent_temperature, precipitation_probability,
            precipitation, wind_speed_10m, weather_code
       FROM hourly_forecast
      WHERE fetch_run_id = $1 AND forecast_time >= date_trunc('hour', $2::timestamptz)
      ORDER BY forecast_time
      LIMIT $3`, [run.id, now, hours]);
  return {
    ...base,
    hours,
    hourly: rows.map((r) => ({
      time: toLocalIso(r.forecast_time, location.timezone),
      temperature: num(r.temperature_2m),
      apparent_temperature: num(r.apparent_temperature),
      precipitation_probability: r.precipitation_probability,
      precipitation: num(r.precipitation),
      wind_speed: num(r.wind_speed_10m),
      weather_code: r.weather_code,
    })),
  };
}

export async function daily(pool, rawId, now) {
  const location = await findActiveLocation(pool, rawId);
  const run = await getLatestSuccessfulRun(pool, location.id);
  const base = envelope(location, run, now);
  if (!run) return { ...base, daily: [] };

  const { rows } = await pool.query(
    `SELECT forecast_date::text AS date, temperature_max, temperature_min, precipitation_sum,
            precipitation_probability_max, wind_speed_max, weather_code, is_risk, risk_reasons
       FROM daily_forecast WHERE fetch_run_id = $1 ORDER BY forecast_date`, [run.id]);
  return {
    ...base,
    daily: rows.map((r) => ({
      date: r.date,
      temperature_max: num(r.temperature_max),
      temperature_min: num(r.temperature_min),
      precipitation_sum: num(r.precipitation_sum),
      precipitation_probability_max: r.precipitation_probability_max,
      wind_speed_max: num(r.wind_speed_max),
      weather_code: r.weather_code,
      is_risk: r.is_risk,
      risk_reasons: r.risk_reasons,
    })),
  };
}

/** Status do último fetch_run (qualquer status) de cada local ativo. */
export async function health(pool, now) {
  const { rows: locations } = await pool.query(
    'SELECT id, name, timezone FROM locations WHERE active ORDER BY id');
  const items = [];
  for (const loc of locations) {
    const { rows } = await pool.query(
      `SELECT status, http_status, error_message, started_at, finished_at
         FROM fetch_runs WHERE location_id = $1 ORDER BY started_at DESC LIMIT 1`, [loc.id]);
    const run = await getLatestSuccessfulRun(pool, loc.id);
    const last = rows[0];
    items.push({
      location: { id: loc.id, name: loc.name },
      last_run: last ? {
        status: last.status,
        http_status: last.http_status,
        error_message: last.error_message,
        started_at: toLocalIso(last.started_at, loc.timezone),
        finished_at: toLocalIso(last.finished_at, loc.timezone),
      } : null,
      last_updated_at: run ? toLocalIso(run.lastSuccessAt, loc.timezone) : null,
      stale: isStale(run?.lastSuccessAt, now),
    });
  }
  return { status: 'ok', checked_at: now.toISOString(), locations: items };
}
