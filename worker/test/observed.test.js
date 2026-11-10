import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb } from '../../packages/db/test/helpers.js';
import { seed } from '../../packages/db/src/seed.js';
import { OpenMeteoError } from '../src/openmeteo.js';
import { civilDate, shiftDate, runObservedAll } from '../src/observed.js';

let pool;
const now = new Date('2026-11-10T06:00:00Z'); // 03:00 em São Paulo

const payload = (extra = {}) => ({
  daily: {
    time: ['2026-11-01', '2026-11-02', '2026-11-03'],
    temperature_2m_max: [27, 28, null],
    temperature_2m_min: [20, 21, null],
    precipitation_sum: [0, 4.2, null],
    wind_speed_10m_max: [10, 12, null],
    ...extra,
  },
});
const okFetcher = (calls = []) => async (loc, start, end) => {
  calls.push({ loc: loc.name, start, end });
  return { httpStatus: 200, payload: payload() };
};
const count = async () => (await pool.query('SELECT count(*)::int n FROM observed_daily')).rows[0].n;

beforeAll(async () => { pool = await setupTestDb('worker_observed'); });
afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await pool.query('TRUNCATE observed_daily, fetch_runs, risk_rules, locations RESTART IDENTITY CASCADE');
  await seed(pool);
});

describe('datas', () => {
  it('civilDate usa o fuso do local e shiftDate volta dias', () => {
    expect(civilDate(new Date('2026-11-10T01:00:00Z'), 'America/Sao_Paulo')).toBe('2026-11-09');
    expect(shiftDate('2026-11-10', -30)).toBe('2026-10-11');
  });
});

describe('job do observado', () => {
  it('grava só os dias com dado e pede a janela de 30 dias', async () => {
    const calls = [];
    const { results } = await runObservedAll(pool, { fetcher: okFetcher(calls), wait: async () => {}, now });
    expect(results.every((r) => r.status === 'success' && r.days === 2)).toBe(true);
    expect(calls[0]).toMatchObject({ start: '2026-10-11', end: '2026-11-10' });
    expect(await count()).toBe(results.length * 2);
  });

  it('rodar duas vezes não duplica e atualiza o valor', async () => {
    const opts = { fetcher: okFetcher(), wait: async () => {}, now };
    await runObservedAll(pool, opts);
    const first = await count();
    await runObservedAll(pool, {
      ...opts,
      fetcher: async () => ({ payload: payload({ precipitation_sum: [0, 9.9, null] }) }),
    });
    expect(await count()).toBe(first);
    const { rows } = await pool.query(`SELECT precipitation_sum::float8 p FROM observed_daily WHERE date = '2026-11-02' LIMIT 1`);
    expect(rows[0].p).toBe(9.9);
  });

  it('falha de um local não bloqueia os outros; retry em erro retryable', async () => {
    let santosCalls = 0;
    const fetcher = async (loc) => {
      if (loc.name === 'Santos') { santosCalls++; throw new OpenMeteoError('HTTP 503', { httpStatus: 503, retryable: true }); }
      return { payload: payload() };
    };
    const { results } = await runObservedAll(pool, { fetcher, wait: async () => {}, now });
    expect(results.find((r) => r.location === 'Santos')).toMatchObject({ status: 'error' });
    expect(results.filter((r) => r.status === 'success').length).toBe(results.length - 1);
    expect(santosCalls).toBe(3);
    const { rows } = await pool.query(`SELECT count(*)::int n FROM observed_daily o JOIN locations l ON l.id = o.location_id WHERE l.name = 'Santos'`);
    expect(rows[0].n).toBe(0);
  });

  it('payload inválido vira erro sem gravar', async () => {
    const { results } = await runObservedAll(pool, { fetcher: async () => ({ payload: {} }), wait: async () => {}, now });
    expect(results.every((r) => r.status === 'error')).toBe(true);
    expect(await count()).toBe(0);
  });

  it('execução simultânea é pulada pelo lock', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const slow = async () => { await gate; return { payload: payload() }; };
    const first = runObservedAll(pool, { fetcher: slow, now });
    await new Promise((r) => setTimeout(r, 200));
    expect((await runObservedAll(pool, { fetcher: okFetcher(), now })).skipped).toBe(true);
    release();
    expect((await first).skipped).toBe(false);
  });
});
