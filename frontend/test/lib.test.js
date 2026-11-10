import { describe, expect, it } from 'vitest';
import { weatherInfo } from '../lib/wmo.js';
import { S } from '../lib/strings.js';
import { fmtDiffKmh, fmtDiffMm, fmtDiffTemp, historyBadges, describeRiskReasons, fmtDayLabel, fmtHour, fmtKmh, fmtMm, fmtPct, fmtTemp, fmtUpdatedAt } from '../lib/format.js';

describe('wmo', () => {
  it('mapeia códigos conhecidos com ícone e descrição pt-BR', () => {
    expect(weatherInfo(3)).toEqual({ icon: '☁️', description: 'Nublado' });
    expect(weatherInfo(95).description).toBe('Trovoada');
  });
  it('cai em condição desconhecida', () => {
    expect(weatherInfo(1234).description).toBe('Condição desconhecida');
    expect(weatherInfo(null).description).toBe('Condição desconhecida');
  });
});

describe('format', () => {
  it('formata unidades em pt-BR', () => {
    expect(fmtTemp(24.1)).toBe('24,1 °C');
    expect(fmtMm(6.2)).toBe('6,2 mm');
    expect(fmtKmh(28.4)).toBe('28,4 km/h');
    expect(fmtPct(70)).toBe('70 %');
    expect(fmtTemp(null)).toBe('—');
  });
  it('converte a última atualização para America/Sao_Paulo', () => {
    expect(fmtUpdatedAt('2026-11-04T21:30:00-03:00')).toBe('04/11 às 21:30');
    expect(fmtUpdatedAt('2026-11-05T00:30:00Z')).toBe('04/11 às 21:30');
    expect(fmtHour('2026-11-05T00:30:00Z')).toBe('21:30');
    expect(fmtUpdatedAt(null)).toBe('—');
  });
  it('rotula o dia sem deslocar por fuso', () => {
    expect(fmtDayLabel('2026-11-07')).toEqual({ weekday: 'sáb', day: '07/11' });
  });
  it('descreve o risco só com regra e valor', () => {
    const day = {
      risk_reasons: ['rain_probability', 'wind_speed'],
      precipitation_probability_max: 70, wind_speed_max: 36.2,
    };
    expect(describeRiskReasons(day)).toEqual(['Chance de chuva 70 %', 'Vento 36,2 km/h']);
    expect(describeRiskReasons({ risk_reasons: [] })).toEqual([]);
  });
});

describe('comparação', () => {
  it('formata diferença com sinal explícito e unidade', () => {
    expect(fmtDiffTemp(1.6)).toBe('+1,6 °C');
    expect(fmtDiffMm(-3.5)).toBe('−3,5 mm');
    expect(fmtDiffKmh(0)).toBe('0,0 km/h');
    expect(fmtDiffTemp(null)).toBe('—');
  });
  const base = { forecast: { temperature_max: 30 }, observed_status: 'available', coverage_pct: 100 };
  it('dia completo e com observado não tem selo', () => {
    expect(historyBadges(base)).toEqual([]);
  });
  it('cobertura parcial mostra a porcentagem', () => {
    expect(historyBadges({ ...base, coverage_pct: 50 })).toEqual(['Cobertura parcial (50 %)']);
  });
  it('observado indisponível e sem previsão têm selos próprios', () => {
    expect(historyBadges({ ...base, observed_status: 'unavailable' })).toEqual(['Observado indisponível']);
    expect(historyBadges({ forecast: null, observed_status: 'unavailable', coverage_pct: 0 }))
      .toEqual(['Sem previsão D-1', 'Observado indisponível']);
  });
});

describe('strings', () => {
  it('nenhuma string sugere ação (verbos no imperativo / recomendações)', () => {
    const all = JSON.stringify(S).toLowerCase();
    for (const bad of ['leve', 'use ', 'evite', 'recomend', 'guarda-chuva', 'proteja', 'cuidado', 'prefira']) {
      expect(all).not.toContain(bad);
    }
  });
});
