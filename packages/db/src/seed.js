export const SEED_LOCATIONS = [
  { name: 'Santos', latitude: -23.9608, longitude: -46.3336 },
  { name: 'São Paulo', latitude: -23.5505, longitude: -46.6333 },
  { name: 'Rio de Janeiro', latitude: -22.9068, longitude: -43.1729 },
];

export const SEED_RISK_RULES = [
  { key: 'rain_probability', threshold: 60, unit: '%' },
  { key: 'precipitation_daily', threshold: 5, unit: 'mm' },
  { key: 'wind_speed', threshold: 35, unit: 'km/h' },
];

/** Idempotente: só insere o que não existe; nunca altera valores já ajustados. */
export async function seed(pool) {
  for (const l of SEED_LOCATIONS) {
    await pool.query(
      `INSERT INTO locations (name, latitude, longitude) VALUES ($1,$2,$3)
       ON CONFLICT (name) DO NOTHING`,
      [l.name, l.latitude, l.longitude],
    );
  }
  for (const r of SEED_RISK_RULES) {
    await pool.query(
      `INSERT INTO risk_rules (key, threshold, unit) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO NOTHING`,
      [r.key, r.threshold, r.unit],
    );
  }
}
