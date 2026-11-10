import { S } from './strings.js';

export const TZ = 'America/Sao_Paulo';

const NA = '—';
const nf = (digits) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const n0 = nf(0);
const n1 = nf(1);

const isNum = (v) => v != null && Number.isFinite(Number(v));

export const fmtNum = (v) => (isNum(v) ? n1.format(v) : NA);
export const fmtTemp = (v) => (isNum(v) ? `${n1.format(v)} ${S.units.temp}` : NA);
export const fmtTempInt = (v) => (isNum(v) ? `${n0.format(v)}${S.units.temp}` : NA);
export const fmtMm = (v) => (isNum(v) ? `${n1.format(v)} ${S.units.mm}` : NA);
export const fmtKmh = (v) => (isNum(v) ? `${n1.format(v)} ${S.units.kmh}` : NA);
export const fmtPct = (v) => (isNum(v) ? `${n0.format(v)} ${S.units.pct}` : NA);

const partsFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** ISO 8601 -> "dd/mm às hh:mm" em America/Sao_Paulo. */
export function fmtUpdatedAt(iso) {
  if (!iso) return NA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NA;
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}

/** ISO 8601 -> "hh:mm" (rótulo de eixo). */
export function fmtHour(iso) {
  return fmtUpdatedAt(iso).split(' às ')[1] ?? NA;
}

/** "2026-11-07" -> { weekday: "sáb", day: "07/11" } sem deslocar por fuso. */
export function fmtDayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' })
    .format(dt).replace('.', '');
  return { weekday, day: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}` };
}

const signed = (digits, unit) => (v) => {
  if (!isNum(v)) return NA;
  const n = Number(v);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${nf(digits).format(Math.abs(n))} ${unit}`;
};
/** Diferença com sinal explícito e unidade, ex.: "+1,6 °C". */
export const fmtDiffTemp = signed(1, S.units.temp);
export const fmtDiffMm = signed(1, S.units.mm);
export const fmtDiffKmh = signed(1, S.units.kmh);

/** Selos da linha de comparação (só descrevem o estado dos dados). */
export function historyBadges(day) {
  const badges = [];
  if (!day.forecast) badges.push(S.compare.noForecast);
  else if (day.coverage_pct < 100) badges.push(`${S.compare.partial} (${day.coverage_pct} ${S.units.pct})`);
  if (day.observed_status !== 'available') badges.push(S.compare.unavailable);
  return badges;
}

// Campo do dia e formatador de cada regra (limites nunca ficam aqui; só rótulo e valor).
const RULE_DISPLAY = {
  rain_probability: ['precipitation_probability_max', fmtPct],
  precipitation_daily: ['precipitation_sum', fmtMm],
  wind_speed: ['wind_speed_max', fmtKmh],
};

/** Descreve só regra e valor do dia, ex.: "Chance de chuva 70 %". */
export function describeRiskReasons(day) {
  return (day.risk_reasons ?? []).map((key) => {
    const label = S.riskRules[key] ?? key;
    const rule = RULE_DISPLAY[key];
    if (!rule) return label;
    const [field, fmt] = rule;
    return `${label} ${fmt(day[field])}`;
  });
}
