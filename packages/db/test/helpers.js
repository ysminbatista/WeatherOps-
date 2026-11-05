import { createPool } from '../src/pool.js';
import { migrate } from '../src/migrate.js';

const url = process.env.DATABASE_URL ?? 'postgres://weatherops:weatherops@localhost:5433/weatherops';

/** Cria um banco isolado por arquivo de teste, para não tocar nos dados do compose. */
export async function setupTestDb(name) {
  const dbName = `weatherops_test_${name}`;
  const admin = createPool(url);
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const pool = createPool(url.replace(/\/[^/]+$/, `/${dbName}`));
  await migrate(pool);
  return pool;
}
