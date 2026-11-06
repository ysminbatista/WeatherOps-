// Único ponto de acesso à Open-Meteo Forecast API.
export const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1/forecast';
export const TIMEOUT_MS = 10_000;

const CURRENT = 'temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code';
const HOURLY = 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,weather_code';
const DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code';

/** Erro com http_status (nulo se não houve resposta) e flag de retry. */
export class OpenMeteoError extends Error {
  constructor(message, { httpStatus = null, retryable = false } = {}) {
    super(message);
    this.name = 'OpenMeteoError';
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export function buildUrl(location, baseUrl = process.env.OPEN_METEO_URL ?? DEFAULT_BASE_URL) {
  const params = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    current: CURRENT,
    hourly: HOURLY,
    daily: DAILY,
    forecast_days: 7,
    timezone: location.timezone ?? 'America/Sao_Paulo',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  });
  return `${baseUrl}?${params}`;
}

/** Uma tentativa: timeout de 10 s; timeout, 5xx e 429 são retryable. */
export async function fetchForecast(location, { baseUrl, timeoutMs = TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetch(buildUrl(location, baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
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
