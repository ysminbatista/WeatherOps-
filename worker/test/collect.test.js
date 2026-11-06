import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb } from '../../packages/db/test/helpers.js';
import { seed } from '../../packages/db/src/seed.js';
import { fetchForecast } from '../src/openmeteo.js';
import { runAll } from '../src/run-all.js';

function payload(days = 7) {
  const dates = Array.from({ length: days }, (_, i) => `2026-11-${String(5 + i).padStart(2, '0')}`);
  const hours = dates.flatMap((d) => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`));
  const fill = (n, v) => Array(n).fill(v);
  return {
    current: { time: '2026-11-05T14:30', temperature_2m: 24.1, apparent_temperature: 26.3, precipitation: 0, wind_speed_10m: 12, weather_code: 3 },
    hourly: {
      time: hours, temperature_2m: fill(hours.length, 22), apparent_temperature: fill(hours.length, 23),
      precipitation_probability: fill(hours.length, 10), precipitation: fill(hours.length, 0),
      wind_speed_10m: fill(hours.length, 10), weather_code: fill(hours.length, 1),
    },
    daily: {
      time: dates, temperature_2m_max: fill(days, 28), temperature_2m_min: fill(days, 20),
      precipitation_sum: [6.2, ...fill(days - 1, 0)], precipitation_probability_max: [70, ...fill(days - 1, 10)],
      wind_speed_10m_max: [20, 40, ...fill(days - 2, 10)], weather_code: fill(days, 3),
    },
  };
}

let server, baseUrl, pool;
// O handler é trocado por teste; o servidor falso nunca é a API real.
let handler;
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const fetcher = (loc) => fetchForecast(loc, { baseUrl, timeoutMs: 300 });
const opts = { fetcher, wait: async () => {} };
const counts = async () => {
  const q = async (t) => (await pool.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
  return { current: await q('current_conditions'), hourly: await q('hourly_forecast'), daily: await q('daily_forecast') };
};

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1/forecast`;
  pool = await setupTestDb('worker_collect');
});
afterAll(async () => { server.closeAllConnections(); server.close(); await pool.end(); });
beforeEach(async () => {
  await pool.query('TRUNCATE fetch_runs, risk_rules, locations RESTART IDENTITY CASCADE');
  await seed(pool);
  handler = (req, res) => json(res, 200, payload());
});

describe('coleta bem-sucedida', () => {
  it('grava snapshot completo para os 3 locais, com risco calculado', async () => {
    const { results } = await runAll(pool, opts);
    expect(results.map((r) => r.status)).toEqual(['success', 'success', 'success']);
    expect(await counts()).toEqual({ current: 3, hourly: 3 * 168, daily: 3 * 7 });
    const { rows } = await pool.query(
      'SELECT forecast_date::text d, is_risk, risk_reasons FROM daily_forecast WHERE fetch_run_id = $1 ORDER BY forecast_date',
      [results[0].runId]);
    expect(rows[0]).toMatchObject({ d: '2026-11-05', is_risk: true, risk_reasons: ['rain_probability', 'precipitation_daily'] });
    expect(rows[1]).toMatchObject({ is_risk: true, risk_reasons: ['wind_speed'] });
    expect(rows[2]).toMatchObject({ is_risk: false, risk_reasons: [] });
  });

  it('interpreta horários no fuso do local (-03:00)', async () => {
    await runAll(pool, opts);
    const { rows } = await pool.query('SELECT observed_at FROM current_conditions LIMIT 1');
    expect(rows[0].observed_at.toISOString()).toBe('2026-11-05T17:30:00.000Z');
  });

  it('nova coleta não sobrescreve a anterior', async () => {
    await runAll(pool, opts);
    await runAll(pool, opts);
    expect((await counts()).daily).toBe(2 * 3 * 7);
    expect((await pool.query("SELECT count(*)::int n FROM fetch_runs WHERE status='success'")).rows[0].n).toBe(6);
  });

  it('mudar risk_rules muda is_risk na coleta seguinte', async () => {
    await runAll(pool, opts);
    await pool.query("UPDATE risk_rules SET threshold = 5 WHERE key = 'wind_speed'");
    const { results } = await runAll(pool, opts);
    const { rows } = await pool.query(
      "SELECT count(*)::int n FROM daily_forecast WHERE fetch_run_id = $1 AND 'wind_speed' = ANY(risk_reasons)", [results[0].runId]);
    expect(rows[0].n).toBe(7);
  });
});

describe('falhas da API simulada', () => {
  const cases = {
    timeout: [() => {}, null, /Timeout/],
    '5xx': [(req, res) => json(res, 503, {}), 503, /HTTP 503/],
    429: [(req, res) => json(res, 429, {}), 429, /HTTP 429/],
    'payload vazio': [(req, res) => json(res, 200, { current: {}, hourly: { time: [] }, daily: { time: [] } }), 200, /Payload inválido/],
  };
  for (const [name, [h, status, msg]] of Object.entries(cases)) {
    it(`${name}: status error e nenhuma linha parcial`, async () => {
      handler = h;
      const { results } = await runAll(pool, opts);
      expect(results.every((r) => r.status === 'error')).toBe(true);
      expect(await counts()).toEqual({ current: 0, hourly: 0, daily: 0 });
      const { rows } = await pool.query('SELECT status, http_status, error_message, raw_payload FROM fetch_runs ORDER BY id');
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({ status: 'error', http_status: status, raw_payload: null });
      expect(rows[0].error_message).toMatch(msg);
    });
  }

  it('retry: 429 duas vezes e depois sucesso resulta em success', async () => {
    let calls = 0;
    handler = (req, res) => (++calls <= 2 ? json(res, 429, {}) : json(res, 200, payload()));
    await pool.query('UPDATE locations SET active = false WHERE id > 1');
    const { results } = await runAll(pool, opts);
    expect(results[0].status).toBe('success');
    expect(calls).toBe(3);
  });

  it('falha em um local não impede os outros', async () => {
    let n = 0;
    handler = (req, res) => (++n === 1 ? json(res, 400, {}) : json(res, 200, payload()));
    const { results } = await runAll(pool, opts);
    expect(results.map((r) => r.status)).toEqual(['error', 'success', 'success']);
    expect((await counts()).current).toBe(2);
  });

  it('falha no meio da gravação faz rollback das tabelas filhas', async () => {
    const bad = payload();
    bad.daily.time[3] = 'nao-e-data';
    handler = (req, res) => json(res, 200, bad);
    const { results } = await runAll(pool, opts);
    expect(results.every((r) => r.status === 'error')).toBe(true);
    expect(await counts()).toEqual({ current: 0, hourly: 0, daily: 0 });
  });
});

describe('concorrência', () => {
  it('duas execuções simultâneas não duplicam dados', async () => {
    handler = (req, res) => setTimeout(() => json(res, 200, payload()), 100);
    const [a, b] = await Promise.all([runAll(pool, opts), runAll(pool, opts)]);
    expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
    expect(await counts()).toEqual({ current: 3, hourly: 3 * 168, daily: 3 * 7 });
    expect((await pool.query('SELECT count(*)::int n FROM fetch_runs')).rows[0].n).toBe(3);
  });

  it('runs "running" órfãos viram error na próxima execução', async () => {
    await pool.query("INSERT INTO fetch_runs (location_id, status) VALUES (1, 'running')");
    await runAll(pool, opts);
    const { rows } = await pool.query('SELECT status FROM fetch_runs WHERE id = 1');
    expect(rows[0].status).toBe('error');
  });
});
