import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildHistoricalUrl, fetchHistorical, parseObserved } from '../src/historical.js';

const santos = { latitude: -23.9608, longitude: -46.3336, timezone: 'America/Sao_Paulo' };

describe('buildHistoricalUrl (contrato)', () => {
  it('usa host archive, models=era5, campos diários e unidades explícitas', () => {
    const url = new URL(buildHistoricalUrl(santos, '2026-10-10', '2026-11-09'));
    expect(url.origin + url.pathname).toBe('https://archive-api.open-meteo.com/v1/archive');
    const p = url.searchParams;
    expect(p.get('models')).toBe('era5');
    expect(p.get('start_date')).toBe('2026-10-10');
    expect(p.get('end_date')).toBe('2026-11-09');
    expect(p.get('daily')).toBe('temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max');
    expect(p.get('timezone')).toBe('America/Sao_Paulo');
    expect([p.get('temperature_unit'), p.get('wind_speed_unit'), p.get('precipitation_unit')])
      .toEqual(['celsius', 'kmh', 'mm']);
  });
});

describe('parseObserved', () => {
  const payload = {
    daily: {
      time: ['2026-10-28', '2026-10-29', '2026-10-30'],
      temperature_2m_max: [27, 28, null],
      temperature_2m_min: [20, 21, null],
      precipitation_sum: [0, 4.2, null],
      wind_speed_10m_max: [10, 12, null],
    },
  };
  it('descarta dias com null (defasagem da reanálise)', () => {
    expect(parseObserved(payload)).toEqual([
      { date: '2026-10-28', temperature_max: 27, temperature_min: 20, precipitation_sum: 0, wind_speed_max: 10 },
      { date: '2026-10-29', temperature_max: 28, temperature_min: 21, precipitation_sum: 4.2, wind_speed_max: 12 },
    ]);
  });
  it('payload sem daily ou com série faltando é erro', () => {
    expect(() => parseObserved({})).toThrow();
    expect(() => parseObserved({ daily: { time: ['2026-10-28'] } })).toThrow();
  });
});

describe('fetchHistorical', () => {
  let server, baseUrl, handler;
  beforeAll(async () => {
    server = http.createServer((req, res) => handler(req, res));
    await new Promise((r) => server.listen(0, r));
    baseUrl = `http://127.0.0.1:${server.address().port}/v1/archive`;
  });
  afterAll(() => { server.closeAllConnections(); server.close(); });

  it('503 e 429 são retryable; 400 não', async () => {
    for (const [status, retryable] of [[503, true], [429, true], [400, false]]) {
      handler = (req, res) => { res.writeHead(status); res.end(); };
      await expect(fetchHistorical(santos, 'a', 'b', { baseUrl })).rejects.toMatchObject({ httpStatus: status, retryable });
    }
  });
  it('timeout é retryable', async () => {
    handler = () => {};
    await expect(fetchHistorical(santos, 'a', 'b', { baseUrl, timeoutMs: 100 })).rejects.toMatchObject({ retryable: true });
  });
  it('200 devolve o payload', async () => {
    handler = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"daily":{}}'); };
    await expect(fetchHistorical(santos, 'a', 'b', { baseUrl })).resolves.toEqual({ httpStatus: 200, payload: { daily: {} } });
  });
});
