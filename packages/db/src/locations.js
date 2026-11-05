export const MAX_ACTIVE_LOCATIONS = 3;
const LOCK_KEY = 727002;

export class MaxActiveLocationsError extends Error {
  constructor() {
    super(`Limite de ${MAX_ACTIVE_LOCATIONS} locais ativos atingido`);
    this.name = 'MaxActiveLocationsError';
  }
}

async function withLock(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function countActive(client, excludeId = null) {
  const { rows } = await client.query(
    'SELECT count(*)::int AS n FROM locations WHERE active AND id IS DISTINCT FROM $1',
    [excludeId],
  );
  return rows[0].n;
}

/** Cria um local. Se active=true, recusa quando já houver 3 ativos. */
export function createLocation(pool, { name, latitude, longitude, timezone = 'America/Sao_Paulo', active = true }) {
  return withLock(pool, async (c) => {
    if (active && (await countActive(c)) >= MAX_ACTIVE_LOCATIONS) throw new MaxActiveLocationsError();
    const { rows } = await c.query(
      `INSERT INTO locations (name, latitude, longitude, timezone, active)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, latitude, longitude, timezone, active],
    );
    return rows[0];
  });
}

/** Ativa um local existente, recusando se já houver 3 ativos. */
export function activateLocation(pool, id) {
  return withLock(pool, async (c) => {
    if ((await countActive(c, id)) >= MAX_ACTIVE_LOCATIONS) throw new MaxActiveLocationsError();
    const { rows } = await c.query('UPDATE locations SET active = true WHERE id = $1 RETURNING *', [id]);
    if (!rows[0]) throw new Error(`Local ${id} não encontrado`);
    return rows[0];
  });
}

export async function deactivateLocation(pool, id) {
  await pool.query('UPDATE locations SET active = false WHERE id = $1', [id]);
}
