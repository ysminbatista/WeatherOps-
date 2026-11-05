import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from './helpers.js';
import { seed } from '../src/seed.js';
import { createLocation, activateLocation, deactivateLocation, MaxActiveLocationsError } from '../src/locations.js';

let pool;
beforeAll(async () => { pool = await setupTestDb('seed'); });
afterAll(async () => { await pool.end(); });

const count = async (t) => (await pool.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
const idOf = async (name) => (await pool.query('SELECT id FROM locations WHERE name=$1', [name])).rows[0].id;

describe('seed', () => {
  it('cria 3 locais e 3 regras, sem duplicar ao rodar duas vezes', async () => {
    await seed(pool);
    await seed(pool);
    expect(await count('locations')).toBe(3);
    expect(await count('risk_rules')).toBe(3);
    const { rows } = await pool.query('SELECT key, threshold::float t, unit FROM risk_rules ORDER BY key');
    expect(rows).toEqual([
      { key: 'precipitation_daily', t: 5, unit: 'mm' },
      { key: 'rain_probability', t: 60, unit: '%' },
      { key: 'wind_speed', t: 35, unit: 'km/h' },
    ]);
  });

  it('não sobrescreve um limite já ajustado', async () => {
    await pool.query("UPDATE risk_rules SET threshold = 70 WHERE key='rain_probability'");
    await seed(pool);
    const { rows } = await pool.query("SELECT threshold::float t FROM risk_rules WHERE key='rain_probability'");
    expect(rows[0].t).toBe(70);
  });

  it('inclui Santos ativo', async () => {
    const { rows } = await pool.query("SELECT active FROM locations WHERE name='Santos'");
    expect(rows[0].active).toBe(true);
  });
});

describe('limite de 3 locais ativos', () => {
  it('recusa criar um 4º local ativo', async () => {
    await expect(createLocation(pool, { name: 'Curitiba', latitude: -25.43, longitude: -49.27 }))
      .rejects.toBeInstanceOf(MaxActiveLocationsError);
    expect(await count('locations')).toBe(3);
  });

  it('recusa ativar um 4º local existente', async () => {
    const l = await createLocation(pool, { name: 'Curitiba', latitude: -25.43, longitude: -49.27, active: false });
    await expect(activateLocation(pool, l.id)).rejects.toBeInstanceOf(MaxActiveLocationsError);
  });

  it('permite ativar após desativar outro', async () => {
    await deactivateLocation(pool, await idOf('Rio de Janeiro'));
    expect((await activateLocation(pool, await idOf('Curitiba'))).active).toBe(true);
  });

  it('reativar um local já ativo não conta duas vezes', async () => {
    expect((await activateLocation(pool, await idOf('Santos'))).active).toBe(true);
  });
});
