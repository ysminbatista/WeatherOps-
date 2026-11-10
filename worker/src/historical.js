// Único ponto de acesso à Open-Meteo Historical API (reanálise ERA5).
import { OpenMeteoError, TIMEOUT_MS } from './openmeteo.js';

export const DEFAULT_HISTORICAL_URL = 'https://archive-api.open-meteo.com/v1/archive';
const DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max';

export function buildHistoricalUrl(location, startDate, endDate,
  baseUrl = process.env.OPEN_METEO_ARCHIVE_URL ?? DEFAULT_HISTORICAL_URL) {
  const params = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    start_date: startDate,
    end_date: endDate,
    daily: DAILY,
    models: 'era5', // reanálise pura: sem ele a API mistura modelos quase em tempo real (docs/05)
    timezone: location.timezone ?? 'America/Sao_Paulo',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  });
  return `${baseUrl}?${params}`;
}

/** Uma tentativa: timeout de 10 s; timeout, 5xx e 429 são retryable. */
export async function fetchHistorical(location, startDate, endDate, { baseUrl, timeoutMs = TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetch(buildHistoricalUrl(location, startDate, endDate, baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    throw new OpenMeteoError(timeout ? `Timeout após ${timeoutMs} ms` : `Falha de rede: ${err.message}`, { retryable: true });
  }
  if (!res.ok) {
    throw new OpenMeteoError(`HTTP ${res.status}`, {
      httpStatus: res.status,
      retryable: res.status === 429 || res.status >= 500,
    });
  }
  try {
    return { httpStatus: res.status, payload: await res.json() };
  } catch {
    throw new OpenMeteoError('Resposta não é JSON válido', { httpStatus: res.status });
  }
}

/**
 * Converte o payload em linhas por dia. Dias com `null` em qualquer campo ainda não têm dado
 * (defasagem da reanálise) e são descartados. Payload sem `daily.time` é erro.
 */
export function parseObserved(payload) {
  const d = payload?.daily;
  if (!d || !Array.isArray(d.time)) throw new OpenMeteoError('Payload histórico sem daily.time');
  const fields = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_speed_10m_max'];
  for (const f of fields) {
    if (!Array.isArray(d[f]) || d[f].length !== d.time.length) throw new OpenMeteoError(`Payload histórico sem ${f}`);
  }
  const rows = [];
  d.time.forEach((date, i) => {
    if (fields.some((f) => d[f][i] == null)) return;
    rows.push({
      date,
      temperature_max: d.temperature_2m_max[i],
      temperature_min: d.temperature_2m_min[i],
      precipitation_sum: d.precipitation_sum[i],
      wind_speed_max: d.wind_speed_10m_max[i],
    });
  });
  return rows;
}
