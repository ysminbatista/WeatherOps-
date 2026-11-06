import { OpenMeteoError } from './openmeteo.js';

/** current, hourly e daily precisam existir e não estar vazios. */
export function validatePayload(p) {
  const problems = [];
  if (!p?.current || !p.current.time) problems.push('current');
  if (!p?.hourly || !Array.isArray(p.hourly.time) || p.hourly.time.length === 0) problems.push('hourly');
  if (!p?.daily || !Array.isArray(p.daily.time) || p.daily.time.length === 0) problems.push('daily');
  if (problems.length) throw new OpenMeteoError(`Payload inválido: ${problems.join(', ')} ausente ou vazio`);
}
