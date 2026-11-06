import { describe, it, expect, vi } from 'vitest';
import { evaluateRisk } from '../src/risk.js';
import { withRetry } from '../src/retry.js';
import { validatePayload } from '../src/validate.js';
import { buildUrl, OpenMeteoError } from '../src/openmeteo.js';

const rules = [
  { key: 'rain_probability', threshold: '60', active: true },
  { key: 'precipitation_daily', threshold: '5', active: true },
  { key: 'wind_speed', threshold: '35', active: true },
];

describe('evaluateRisk', () => {
  it('sem regra atingida não é risco', () => {
    expect(evaluateRisk({ precipitation_probability_max: 59, precipitation_sum: 4.9, wind_speed_max: 34.9 }, rules))
      .toEqual({ is_risk: false, risk_reasons: [] });
  });
  it('limite igual dispara (>=) e lista todos os motivos', () => {
    expect(evaluateRisk({ precipitation_probability_max: 60, precipitation_sum: 5, wind_speed_max: 35 }, rules).risk_reasons)
      .toEqual(['rain_probability', 'precipitation_daily', 'wind_speed']);
  });
  it('usa o limite recebido, e ignora regra inativa', () => {
    const custom = [{ key: 'wind_speed', threshold: '20', active: true }, { key: 'rain_probability', threshold: '10', active: false }];
    expect(evaluateRisk({ wind_speed_max: 25, precipitation_probability_max: 90 }, custom).risk_reasons).toEqual(['wind_speed']);
  });
  it('valor nulo não dispara', () => {
    expect(evaluateRisk({ wind_speed_max: null }, rules).is_risk).toBe(false);
  });
});

describe('withRetry', () => {
  const retryable = () => new OpenMeteoError('x', { retryable: true });
  it('tenta 3 vezes no total com backoff 2s e 5s', async () => {
    const fn = vi.fn().mockRejectedValue(retryable());
    const wait = vi.fn().mockResolvedValue();
    await expect(withRetry(fn, { wait })).rejects.toThrow('x');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map((c) => c[0])).toEqual([2000, 5000]);
  });
  it('não repete erro não retryable', async () => {
    const fn = vi.fn().mockRejectedValue(new OpenMeteoError('400', { httpStatus: 400 }));
    await expect(withRetry(fn, { wait: async () => {} })).rejects.toThrow('400');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('devolve o sucesso após falha transitória', async () => {
    const fn = vi.fn().mockRejectedValueOnce(retryable()).mockResolvedValue('ok');
    expect(await withRetry(fn, { wait: async () => {} })).toBe('ok');
  });
});

describe('validatePayload', () => {
  const ok = { current: { time: 't' }, hourly: { time: ['a'] }, daily: { time: ['d'] } };
  it('aceita payload completo', () => expect(() => validatePayload(ok)).not.toThrow());
  it.each([
    ['sem current', { ...ok, current: undefined }],
    ['hourly vazio', { ...ok, hourly: { time: [] } }],
    ['daily ausente', { ...ok, daily: undefined }],
    ['payload nulo', null],
  ])('recusa %s', (_, p) => expect(() => validatePayload(p)).toThrow(/Payload inválido/));
});

describe('buildUrl', () => {
  it('passa unidades, fuso e 7 dias explicitamente', () => {
    const u = new URL(buildUrl({ latitude: -23.9608, longitude: -46.3336, timezone: 'America/Sao_Paulo' }, 'http://x/y'));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      forecast_days: '7', timezone: 'America/Sao_Paulo',
      temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm',
    });
  });
});
