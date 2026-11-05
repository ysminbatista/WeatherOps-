import { createPool } from './pool.js';
import { seed } from './seed.js';

const pool = createPool();
try {
  await seed(pool);
  console.log('Seed aplicado');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
