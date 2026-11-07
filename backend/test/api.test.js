import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb } from '../../packages/db/test/helpers.js';
import { seed } from '../../packages/db/src/seed.js';
import { createServer } from '../src/app.js';
import { isStale, toLocalIso } from '../src/snapshot.js';

let pool, server, base;
let now = new Date('2026-11-05T17:40:00Z'); // 14:40 em São Paulo (-03:00)

/** Insere um fetch_run de sucesso com snapshot completo (7 dias, 168 horas). */
async function insertSuccess(locationId, startedAt, { prob = 10, tempOffset = 0 } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO fetch_runs (location_id, started_at, finished_at, status, http_status)
     VALUES ($1, $2, $2, 'success', 200) RETURNING id`, [locationId, startedAt]);
  const runId = rows[0].id;
  await pool.query(
    `INSERT INTO current_conditions (fetch_run_id, location_id, observed_at, temperature_2m, apparent_temperature, weather_code)
     VALUES ($1,$2,$3,24.1 + $4,26.3,3)`, [runId, locationId, startedAt, tempOffset]);
  // 168 horas a partir de 05/11 00:00 (-03:00); probabilidade 90 só às 20:00 de 05/11 e às 23:00 de 06/11.
  await pool.query(
    `INSERT INTO hourly_forecast (fetch_run_id, location_id, forecast_time, temperature_2m, apparent_temperature,
       precipitation_probability, precipitation, wind_speed_10m, weather_code)
     SELECT $1, $2, ts, 22, 23,
            CASE WHEN ts IN ('2026-11-05T20:00:00-03'::timestamptz, '2026-11-06T23:00:00-03'::timestamptz) THEN 90
                 WHEN ts = '2026-11-05T10:00:00-03'::timestamptz THEN 95 ELSE $3::int END,
            0.1, 10, 1
       FROM generate_series('2026-11-05T00:00:00-03'::timestamptz, '2026-11-11T23:00:00-03'::timestamptz, interval '1 hour') ts`,
    [runId, locationId, prob]);
  await pool.query(
    `INSERT INTO daily_forecast (fetch_run_id, location_id, forecast_date, temperature_max, temperature_min,
       precipitation_sum, precipitation_probability_max, wind_speed_max, weather_code, is_risk, risk_reasons)
     SELECT $1, $2, d::date, 28, 20, CASE WHEN d::date = '2026-11-05' THEN 6.2 ELSE 0 END, 70,
            28.4, 3, d::date = '2026-11-05', CASE WHEN d::date = '2026-11-05' THEN '{precipitation_daily}'::text[] ELSE '{}' END
       FROM generate_series('2026-11-05'::date, '2026-11-11'::date, interval '1 day') d`, [runId, locationId]);
  return runId;
}

async function insertError(locationId, startedAt) {
  await pool.query(
    `INSERT INTO fetch_runs (location_id, started_at, finished_at, status, error_message)
     VALUES ($1, $2, $2, 'error', 'timeout')`, [locationId, startedAt]);
}

const get = async (path) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  pool = await setupTestDb('backend_api');
  server = createServer(pool, { now: () => now });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { server.closeAllConnections(); server.close(); await pool.end(); });
beforeEach(async () => {
  now = new Date('2026-11-05T17:40:00Z');
  await pool.query('TRUNCATE fetch_runs, risk_rules, locations RESTART IDENTITY CASCADE');
  await seed(pool);
});

describe('stale', () => {
  it('é falso até 60 min e verdadeiro depois', () => {
    const last = new Date('2026-11-05T17:00:00Z');
    expect(isStale(last, new Date('2026-11-05T18:00:00Z'))).toBe(false);
    expect(isStale(last, new Date('2026-11-05T18:00:01Z'))).toBe(true);
    expect(isStale(null, now)).toBe(true);
  });

  it('toLocalIso usa o offset do fuso do local', () => {
    expect(toLocalIso(new Date('2026-11-05T00:30:00Z'), 'America/Sao_Paulo')).toBe('2026-11-04T21:30:00-03:00');
  });
});

describe('GET /api/locations', () => {
  it('lista os locais ativos', async () => {
    const { status, body } = await get('/api/locations');
    expect(status).toBe(200);
    expect(body.locations).toHaveLength(3);
    expect(body.locations[0]).toMatchObject({ id: 1, name: 'Santos', timezone: 'America/Sao_Paulo' });
  });
});

describe('GET /api/locations/:id/summary', () => {
  it('devolve indicadores do snapshot mais recente com sucesso', async () => {
    await insertSuccess(1, '2026-11-05T17:30:00Z');
    const { status, body } = await get('/api/locations/1/summary');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      location: { id: 1, name: 'Santos' },
      last_updated_at: '2026-11-05T14:30:00-03:00',
      stale: false,
      has_data: true,
      current: { temperature: 24.1, apparent_temperature: 26.3, weather_code: 3 },
      today: { precipitation_sum: 6.2, wind_speed_max: 28.4, temperature_min: 20, temperature_max: 28 },
    });
  });

  it('calcula a maior chance de chuva entre agora e agora + 24 h', async () => {
    await insertSuccess(1, '2026-11-05T17:30:00Z');
    // 14:40 -> janela 14:00 de 05/11 até 14:40 de 06/11: pega 20:00 (90) e ignora 10:00 (95, passou)
    // e 23:00 de 06/11 (90, fora da janela).
    let r = await get('/api/locations/1/summary');
    expect(r.body.next_24h_max_precipitation_probability).toBe(90);

    // Sem o pico de 20:00 na janela (agora = 21:10 -> janela até 21:10 de 06/11): 23:00 de 06/11 ainda fora.
    now = new Date('2026-11-06T00:10:00Z'); // 21:10 de 05/11
    r = await get('/api/locations/1/summary');
    expect(r.body.next_24h_max_precipitation_probability).toBe(10);
  });

  it('o pico de 23:00 de 06/11 entra quando a janela o alcança', async () => {
    await insertSuccess(1, '2026-11-05T17:30:00Z');
    now = new Date('2026-11-06T02:30:00Z'); // 23:30 de 05/11 -> janela até 23:30 de 06/11
    const r = await get('/api/locations/1/summary');
    expect(r.body.next_24h_max_precipitation_probability).toBe(90);
  });

  it('"hoje" é o dia civil inteiro no fuso do local', async () => {
    await insertSuccess(1, '2026-11-05T17:30:00Z');
    now = new Date('2026-11-06T02:30:00Z'); // 23:30 de 05/11 em SP, já 06/11 em UTC
    const { body } = await get('/api/locations/1/summary');
    expect(body.today.precipitation_sum).toBe(6.2);
  });
});

describe('fallback e stale', () => {
  it('última coleta com erro: devolve o último sucesso, sem stale se recente', async () => {
    await insertSuccess(1, '2026-11-05T17:30:00Z');
    await insertError(1, '2026-11-05T17:35:00Z');
    const { body } = await get('/api/locations/1/summary');
    expect(body.last_updated_at).toBe('2026-11-05T14:30:00-03:00');
    expect(body.stale).toBe(false);
    expect(body.current.temperature).toBe(24.1);
  });

  it('usa o sucesso mais recente, não o mais antigo', async () => {
    await insertSuccess(1, '2026-11-05T16:00:00Z', { tempOffset: 0 });
    await insertSuccess(1, '2026-11-05T17:00:00Z', { tempOffset: 5 });
    const { body } = await get('/api/locations/1/summary');
    expect(body.current.temperature).toBeCloseTo(29.1);
  });

  it('com a API externa fora por mais de 60 min, devolve o último dado válido com stale: true', async () => {
    await insertSuccess(1, '2026-11-05T15:00:00Z');
    await insertError(1, '2026-11-05T17:30:00Z');
    const { status, body } = await get('/api/locations/1/summary');
    expect(status).toBe(200);
    expect(body.stale).toBe(true);
    expect(body.has_data).toBe(true);
    expect(body.last_updated_at).toBe('2026-11-05T12:00:00-03:00');
    expect(body.current.temperature).toBe(24.1);
  });

  it('todos os endpoints compartilham o mesmo fallback', async () => {
    await insertSuccess(1, '2026-11-05T15:00:00Z');
    await insertError(1, '2026-11-05T17:30:00Z');
    for (const path of ['summary', 'hourly', 'daily']) {
      const { body } = await get(`/api/locations/1/${path}`);
      expect(body).toMatchObject({ stale: true, has_data: true, last_updated_at: '2026-11-05T12:00:00-03:00' });
    }
  });
});

describe('local sem coleta bem-sucedida', () => {
  it('summary, hourly e daily devolvem o estado vazio sem erro 500', async () => {
    await insertError(1, '2026-11-05T17:30:00Z');
    const s = await get('/api/locations/1/summary');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ has_data: false, last_updated_at: null, stale: true, current: null, today: null,
      next_24h_max_precipitation_probability: null });
    const h = await get('/api/locations/1/hourly');
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ has_data: false, hourly: [] });
    const d = await get('/api/locations/1/daily');
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ has_data: false, daily: [] });
  });
});

describe('GET /hourly e /daily', () => {
  beforeEach(async () => { await insertSuccess(1, '2026-11-05T17:30:00Z'); });

  it('hourly respeita hours e começa na hora cheia atual', async () => {
    const { body } = await get('/api/locations/1/hourly?hours=48');
    expect(body.hourly).toHaveLength(48);
    expect(body.hourly[0].time).toBe('2026-11-05T14:00:00-03:00');
    expect(body.hourly[0]).toMatchObject({ temperature: 22, precipitation_probability: 10, wind_speed: 10 });
  });

  it('hourly usa 48 por padrão e limita a 168', async () => {
    expect((await get('/api/locations/1/hourly')).body.hourly).toHaveLength(48);
    expect((await get('/api/locations/1/hourly?hours=9999')).body.hourly.length).toBeLessThanOrEqual(168);
  });

  it('hourly recusa hours inválido', async () => {
    expect((await get('/api/locations/1/hourly?hours=abc')).status).toBe(400);
    expect((await get('/api/locations/1/hourly?hours=0')).status).toBe(400);
  });

  it('daily devolve 7 dias com is_risk e risk_reasons', async () => {
    const { body } = await get('/api/locations/1/daily');
    expect(body.daily).toHaveLength(7);
    expect(body.daily[0]).toMatchObject({
      date: '2026-11-05', is_risk: true, risk_reasons: ['precipitation_daily'], precipitation_sum: 6.2,
    });
    expect(body.daily[1]).toMatchObject({ date: '2026-11-06', is_risk: false, risk_reasons: [] });
  });
});

describe('GET /api/health', () => {
  it('traz o último fetch_run de cada local', async () => {
    await insertSuccess(1, '2026-11-05T17:00:00Z');
    await insertError(1, '2026-11-05T17:30:00Z');
    const { status, body } = await get('/api/health');
    expect(status).toBe(200);
    expect(body.locations).toHaveLength(3);
    expect(body.locations[0]).toMatchObject({
      location: { id: 1, name: 'Santos' },
      last_run: { status: 'error', error_message: 'timeout' },
      last_updated_at: '2026-11-05T14:00:00-03:00',
      stale: false,
    });
    expect(body.locations[1]).toMatchObject({ last_run: null, last_updated_at: null, stale: true });
  });
});

describe('erros', () => {
  it('404 para local inexistente ou inativo, 400 para id inválido', async () => {
    expect((await get('/api/locations/999/summary')).status).toBe(404);
    expect((await get('/api/locations/abc/summary')).status).toBe(400);
    await pool.query('UPDATE locations SET active = false WHERE id = 2');
    expect((await get('/api/locations/2/daily')).status).toBe(404);
  });

  it('404 para rota desconhecida e 405 para métodos de escrita', async () => {
    expect((await get('/api/nada')).status).toBe(404);
    const res = await fetch(`${base}/api/locations`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});
