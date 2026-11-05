import { createPool } from './pool.js';
import { migrate } from './migrate.js';

const pool = createPool();
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Migrations aplicadas: ${applied.join(', ')}` : 'Nenhuma migration pendente');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
