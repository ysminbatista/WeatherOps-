// Único ponto de acesso a dados: só chama /api/* do backend (nunca a Open-Meteo).
export const REFRESH_MS = 5 * 60 * 1000;

async function getJson(path, signal) {
  const res = await fetch(path, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);
  return res.json();
}

export async function fetchLocations(signal) {
  return (await getJson('/api/locations', signal)).locations;
}

export async function fetchDashboard(id, signal) {
  const base = `/api/locations/${id}`;
  const [summary, hourly, daily] = await Promise.all([
    getJson(`${base}/summary`, signal),
    getJson(`${base}/hourly?hours=48`, signal),
    getJson(`${base}/daily`, signal),
  ]);
  return { summary, hourly: hourly.hourly, daily: daily.daily };
}
