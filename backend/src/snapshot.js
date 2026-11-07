export const STALE_AFTER_MS = 60 * 60 * 1000;

/** ISO 8601 com o offset do fuso do local (ex.: 2026-11-04T21:30:00-03:00). */
export function toLocalIso(date, timeZone) {
  if (date == null) return null;
  const d = new Date(date);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace('GMT', '');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** Data civil (YYYY-MM-DD) de um instante no fuso do local. */
export function localDate(date, timeZone) {
  return toLocalIso(date, timeZone).slice(0, 10);
}

/** Desatualizado quando o último sucesso tem mais de 60 min. Sem sucesso algum, também é. */
export function isStale(lastSuccessAt, now) {
  if (lastSuccessAt == null) return true;
  return now.getTime() - new Date(lastSuccessAt).getTime() > STALE_AFTER_MS;
}

/**
 * Única função que decide qual snapshot os endpoints usam: o fetch_run mais recente com
 * status = success do local. Devolve null se nunca houve sucesso.
 */
export async function getLatestSuccessfulRun(pool, locationId) {
  const { rows } = await pool.query(
    `SELECT id, started_at, finished_at
       FROM fetch_runs
      WHERE location_id = $1 AND status = 'success'
      ORDER BY started_at DESC
      LIMIT 1`,
    [locationId],
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, lastSuccessAt: rows[0].finished_at ?? rows[0].started_at };
}

/**
 * Campos comuns a toda resposta: location, last_updated_at, stale, has_data.
 * `run` é o resultado de getLatestSuccessfulRun (ou null).
 */
export function envelope(location, run, now) {
  return {
    location: { id: location.id, name: location.name },
    last_updated_at: run ? toLocalIso(run.lastSuccessAt, location.timezone) : null,
    stale: isStale(run?.lastSuccessAt, now),
    has_data: run != null,
  };
}
