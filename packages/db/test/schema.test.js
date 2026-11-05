import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from './helpers.js';
import { migrate } from '../src/migrate.js';

let pool;
beforeAll(async () => { pool = await setupTestDb('schema'); });
afterAll(async () => { await pool.end(); });

const cols = async (t) =>
  (await pool.query('SELECT column_name FROM information_schema.columns WHERE table_name=$1', [t]))
    .rows.map((r) => r.column_name);

describe('schema', () => {
  it('cria todas as tabelas do spec §5 e observed_daily', async () => {
    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    const names = rows.map((r) => r.table_name);
    for (const t of ['locations', 'fetch_runs', 'current_conditions', 'hourly_forecast',
      'daily_forecast', 'risk_rules', 'observed_daily']) expect(names).toContain(t);
  });

  it('observed_daily tem as colunas esperadas', async () => {
    expect(await cols('observed_daily')).toEqual(expect.arrayContaining(
      ['location_id', 'date', 'temperature_max', 'temperature_min', 'precipitation_sum', 'wind_speed_max', 'fetched_at']));
  });

  it('observed_daily tem chave única local+data', async () => {
    await pool.query("INSERT INTO locations (name, latitude, longitude) VALUES ('X',0,0)");
    const id = (await pool.query("SELECT id FROM locations WHERE name='X'")).rows[0].id;
    await pool.query("INSERT INTO observed_daily (location_id, date) VALUES ($1,'2026-01-01')", [id]);
    await expect(pool.query("INSERT INTO observed_daily (location_id, date) VALUES ($1,'2026-01-01')", [id]))
      .rejects.toThrow(/duplicate key/);
  });

  it('tem o índice (location_id, fetch_run_id, forecast_time)', async () => {
    const { rows } = await pool.query("SELECT indexdef FROM pg_indexes WHERE tablename='hourly_forecast'");
    expect(rows.some((r) => /\(location_id, fetch_run_id, forecast_time\)/.test(r.indexdef))).toBe(true);
  });

  it('apagar fetch_run remove as filhas em cascata, sem tocar observed_daily', async () => {
    const id = (await pool.query("SELECT id FROM locations WHERE name='X'")).rows[0].id;
    const run = (await pool.query(
      "INSERT INTO fetch_runs (location_id, status) VALUES ($1,'success') RETURNING id", [id])).rows[0].id;
    await pool.query('INSERT INTO current_conditions (fetch_run_id, location_id, observed_at) VALUES ($1,$2,now())', [run, id]);
    await pool.query('INSERT INTO hourly_forecast (fetch_run_id, location_id, forecast_time) VALUES ($1,$2,now())', [run, id]);
    await pool.query("INSERT INTO daily_forecast (fetch_run_id, location_id, forecast_date) VALUES ($1,$2,'2026-01-02')", [run, id]);
    await pool.query('DELETE FROM fetch_runs WHERE id=$1', [run]);
    for (const t of ['current_conditions', 'hourly_forecast', 'daily_forecast']) {
      expect((await pool.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n).toBe(0);
    }
    expect((await pool.query('SELECT count(*)::int n FROM observed_daily')).rows[0].n).toBe(1);
  });

  it('rodar migrate de novo não aplica nada', async () => {
    expect(await migrate(pool)).toEqual([]);
  });
});
