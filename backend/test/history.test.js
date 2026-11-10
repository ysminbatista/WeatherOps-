import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb } from '../../packages/db/test/helpers.js';
import { seed } from '../../packages/db/src/seed.js';
import { createServer } from '../src/app.js';
import { coveragePct, difference } from '../src/history.js';

let pool, server, base;
const now = new Date('2026-11-10T15:00:00Z'); // 12:00 em São Paulo; hoje = 2026-11-10

/** Run de sucesso em `startedAt` com previsão para 08/11 (tmax informado). */
async function insertRun(locationId, startedAt, tmax, forecastDate = '2026-11-08') {
  const { rows } = await pool.query(
    `INSERT INTO fetch_runs (location_id, started_at, finished_at, status, http_status)
     VALUES ($1, $2, $2, 'success', 200) RETURNING id`, [locationId, startedAt]);
  await pool.query(
    `INSERT INTO daily_forecast (fetch_run_id, location_id, forecast_date, temperature_max, temperature_min,
       precipitation_sum, precipitation_probability_max, wind_speed_max, weather_code, is_risk, risk_reasons)
     VALUES ($1,$2,$3,$4,20,2,50,30,3,false,'{}')`, [rows[0].id, locationId, forecastDate, tmax]);
}

const get = async (path) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
};
const day = (body, date) => body.history.find((h) => h.date === date);

beforeAll(async () => {
  pool = await setupTestDb('backend_history');
  server = createServer(pool, { now: () => now });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { server.closeAllConnections(); server.close(); await pool.end(); });
beforeEach(async () => {
  await pool.query('TRUNCATE observed_daily, fetch_runs, risk_rules, locations RESTART IDENTITY CASCADE');
  await seed(pool);
});

describe('funções puras', () => {
  it('cobertura = coletas ÷ 48, arredondada e limitada a 100', () => {
    expect(coveragePct(0)).toBe(0);
    expect(coveragePct(24)).toBe(50);
    expect(coveragePct(48)).toBe(100);
    expect(coveragePct(60)).toBe(100);
  });
  it('diferença = observado − previsto; nula se faltar um lado', () => {
    const f = { temperature_max: 30, temperature_min: 20, precipitation_sum: 2, wind_speed_max: 30 };
    const o = { temperature_max: 28.4, temperature_min: 21, precipitation_sum: 5.5, wind_speed_max: 25 };
    expect(difference(f, o)).toEqual({ temperature_max: -1.6, temperature_min: 1, precipitation_sum: 3.5, wind_speed_max: -5 });
    expect(difference(null, o)).toBeNull();
    expect(difference(f, null)).toBeNull();
  });
});

describe('GET /api/locations/:id/history', () => {
  it('escolhe o snapshot mais próximo de 24 h antes e calcula cobertura e diferença', async () => {
    // Para 08/11 o instante de referência é 07/11 00:00 (-03) = 07/11 03:00Z.
    await insertRun(1, '2026-11-07T03:00:00Z', 30);
    await insertRun(1, '2026-11-07T06:00:00Z', 99); // mais longe: não deve ser escolhido
    for (let i = 1; i <= 22; i++) { // completa 24 coletas no dia 07 (hora local) => 50%
      await insertRun(1, new Date(Date.parse('2026-11-07T06:00:00Z') + i * 30 * 60_000).toISOString(), 99);
    }
    await pool.query(
      `INSERT INTO observed_daily (location_id, date, temperature_max, temperature_min, precipitation_sum, wind_speed_max)
       VALUES (1, '2026-11-08', 28.4, 21, 5.5, 25)`);

    const { status, body } = await get('/api/locations/1/history?days=30');
    expect(status).toBe(200);
    expect(body).toMatchObject({ days: 30, observed_source: 'reanalysis', has_data: true });
    expect(body.history).toHaveLength(30);
    expect(body.history[0].date).toBe('2026-11-09'); // hoje não entra; mais recente primeiro

    const d = day(body, '2026-11-08');
    expect(d.forecast.temperature_max).toBe(30);
    expect(d.observed).toMatchObject({ temperature_max: 28.4, precipitation_sum: 5.5 });
    expect(d.observed_status).toBe('available');
    expect(d.difference.temperature_max).toBe(-1.6);
    expect(d.coverage_pct).toBe(50);
  });

  it('dia sem observado é unavailable e a resposta não quebra', async () => {
    await insertRun(1, '2026-11-07T03:00:00Z', 30);
    const { status, body } = await get('/api/locations/1/history');
    expect(status).toBe(200);
    const d = day(body, '2026-11-08');
    expect(d).toMatchObject({ observed: null, observed_status: 'unavailable', difference: null });
    expect(d.forecast.temperature_max).toBe(30);
  });

  it('dia sem snapshot tem forecast nulo e cobertura 0', async () => {
    await pool.query(
      `INSERT INTO observed_daily (location_id, date, temperature_max, temperature_min, precipitation_sum, wind_speed_max)
       VALUES (1, '2026-11-05', 27, 20, 0, 10)`);
    const { body } = await get('/api/locations/1/history');
    expect(day(body, '2026-11-05')).toMatchObject({ forecast: null, difference: null, coverage_pct: 0, observed_status: 'available' });
  });

  it('snapshot a mais de 12 h do instante de referência não é usado', async () => {
    await insertRun(1, '2026-11-07T20:00:00Z', 77); // 17 h depois da referência
    const { body } = await get('/api/locations/1/history');
    expect(day(body, '2026-11-08').forecast).toBeNull();
  });

  it('days limita a 30; inválido é 400; local inexistente é 404; local sem coleta devolve 200', async () => {
    expect((await get('/api/locations/1/history?days=7')).body.history).toHaveLength(7);
    expect((await get('/api/locations/1/history?days=99')).body.days).toBe(30);
    expect((await get('/api/locations/1/history?days=0')).status).toBe(400);
    expect((await get('/api/locations/1/history?days=abc')).status).toBe(400);
    expect((await get('/api/locations/999/history')).status).toBe(404);
    const empty = await get('/api/locations/1/history');
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ has_data: false, stale: true });
  });
});
