import { collectLocation } from './collect.js';

const LOCK_KEY = 727003;

/**
 * Coleta todos os locais ativos. Lock de sessão (pg_try_advisory_lock) numa conexão dedicada:
 * se outra execução já estiver rodando, esta é pulada.
 */
export async function runAll(pool, opts = {}) {
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0].ok) return { skipped: true, results: [] };
    try {
      // Com o lock em mãos, nenhum run 'running' é de execução viva: são sobras de um crash.
      await lockClient.query(
        `UPDATE fetch_runs SET status = 'error', finished_at = now(), error_message = 'Interrompido (worker reiniciado)'
         WHERE status = 'running'`);
      const { rows: locations } = await lockClient.query('SELECT * FROM locations WHERE active ORDER BY id');
      const results = [];
      for (const location of locations) {
        const r = await collectLocation(pool, location, opts);
        results.push({ location: location.name, ...r });
      }
      return { skipped: false, results };
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    lockClient.release();
  }
}
