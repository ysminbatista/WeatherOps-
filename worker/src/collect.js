import { fetchForecast } from './openmeteo.js';
import { withRetry } from './retry.js';
import { validatePayload } from './validate.js';
import { evaluateRisk } from './risk.js';

/** Grava current, hourly e daily de um payload já validado. Roda dentro de uma transação. */
async function saveSnapshot(c, runId, location, payload) {
  const { id: locationId, timezone } = location;
  const { current, hourly: h, daily: d } = payload;

  await c.query(
    `INSERT INTO current_conditions (fetch_run_id, location_id, observed_at, temperature_2m,
       apparent_temperature, precipitation, wind_speed_10m, weather_code)
     VALUES ($1,$2,$3::timestamp AT TIME ZONE $4,$5,$6,$7,$8,$9)`,
    [runId, locationId, current.time, timezone, current.temperature_2m, current.apparent_temperature,
      current.precipitation, current.wind_speed_10m, current.weather_code],
  );

  await c.query(
    `INSERT INTO hourly_forecast (fetch_run_id, location_id, forecast_time, temperature_2m,
       apparent_temperature, precipitation_probability, precipitation, wind_speed_10m, weather_code)
     SELECT $1, $2, t::timestamp AT TIME ZONE $3, a, b, p, pr, w, wc
     FROM unnest($4::text[], $5::numeric[], $6::numeric[], $7::int[], $8::numeric[], $9::numeric[], $10::int[])
       AS u(t, a, b, p, pr, w, wc)`,
    [runId, locationId, timezone, h.time, h.temperature_2m, h.apparent_temperature,
      h.precipitation_probability, h.precipitation, h.wind_speed_10m, h.weather_code],
  );

  const { rows: rules } = await c.query('SELECT key, threshold, active FROM risk_rules');
  for (let i = 0; i < d.time.length; i++) {
    const day = {
      precipitation_probability_max: d.precipitation_probability_max?.[i],
      precipitation_sum: d.precipitation_sum?.[i],
      wind_speed_max: d.wind_speed_10m_max?.[i],
    };
    const { is_risk, risk_reasons } = evaluateRisk(day, rules);
    await c.query(
      `INSERT INTO daily_forecast (fetch_run_id, location_id, forecast_date, temperature_max, temperature_min,
         precipitation_sum, precipitation_probability_max, wind_speed_max, weather_code, is_risk, risk_reasons)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [runId, locationId, d.time[i], d.temperature_2m_max?.[i], d.temperature_2m_min?.[i], day.precipitation_sum,
        day.precipitation_probability_max, day.wind_speed_max, d.weather_code?.[i], is_risk, risk_reasons],
    );
  }
}

/**
 * Coleta um local: cria o run, busca com retry, valida e grava tudo em uma transação.
 * Nunca lança por falha da API; devolve { status, runId, error }.
 */
export async function collectLocation(pool, location, { fetcher = fetchForecast, wait } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO fetch_runs (location_id, status) VALUES ($1, 'running') RETURNING id`, [location.id]);
  const runId = rows[0].id;
  let httpStatus = null;

  try {
    const res = await withRetry(() => fetcher(location), { wait });
    httpStatus = res.httpStatus;
    validatePayload(res.payload);

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await saveSnapshot(c, runId, location, res.payload);
      await c.query(
        `UPDATE fetch_runs SET status = 'success', http_status = $2, raw_payload = $3, finished_at = now()
         WHERE id = $1`, [runId, httpStatus, res.payload]);
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
    return { status: 'success', runId };
  } catch (err) {
    httpStatus = err.httpStatus ?? httpStatus;
    await pool.query(
      `UPDATE fetch_runs SET status = 'error', http_status = $2, error_message = $3, finished_at = now()
       WHERE id = $1`, [runId, httpStatus, String(err.message).slice(0, 500)]);
    return { status: 'error', runId, error: err.message };
  }
}
