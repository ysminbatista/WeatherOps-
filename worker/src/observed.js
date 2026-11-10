import { fetchHistorical, parseObserved } from './historical.js';
import { withRetry } from './retry.js';

export const OBSERVED_DAYS = 30;
const LOCK_KEY = 727004;

/** Data civil (YYYY-MM-DD) de um instante no fuso informado. */
export function civilDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Subtrai dias de uma data YYYY-MM-DD. */
export function shiftDate(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Insere ou atualiza os dias observados; rodar duas vezes não duplica linhas. */
export async function upsertObserved(pool, locationId, rows) {
  for (const r of rows) {
    await pool.query(
      `INSERT INTO observed_daily (location_id, date, temperature_max, temperature_min, precipitation_sum, wind_speed_max, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (location_id, date) DO UPDATE SET
         temperature_max = EXCLUDED.temperature_max, temperature_min = EXCLUDED.temperature_min,
         precipitation_sum = EXCLUDED.precipitation_sum, wind_speed_max = EXCLUDED.wind_speed_max,
         fetched_at = EXCLUDED.fetched_at`,
      [locationId, r.date, r.temperature_max, r.temperature_min, r.precipitation_sum, r.wind_speed_max]);
  }
}

/** Busca e grava o observado de um local. Nunca lança: devolve o resultado. */
export async function collectObserved(pool, location, { fetcher = fetchHistorical, wait, now = new Date() } = {}) {
  try {
    const today = civilDate(now, location.timezone);
    const start = shiftDate(today, -OBSERVED_DAYS);
    const { payload } = await withRetry(() => fetcher(location, start, today), wait ? { wait } : {});
    const rows = parseObserved(payload);
    await upsertObserved(pool, location.id, rows);
    return { status: 'success', days: rows.length };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

/** Roda todos os locais ativos sob lock; se outra execução estiver ativa, é pulada. */
export async function runObservedAll(pool, opts = {}) {
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0].ok) return { skipped: true, results: [] };
    try {
      const { rows: locations } = await lockClient.query('SELECT * FROM locations WHERE active ORDER BY id');
      const results = [];
      for (const location of locations) {
        results.push({ location: location.name, ...(await collectObserved(pool, location, opts)) });
      }
      return { skipped: false, results };
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    lockClient.release();
  }
}
