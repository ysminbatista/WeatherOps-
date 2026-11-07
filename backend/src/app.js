import http from 'node:http';
import { HttpError, daily, health, hourly, listLocations, summary } from './routes.js';

/**
 * Servidor HTTP de leitura. Lê só do banco; nunca chama a Open-Meteo.
 * `now` é injetável para os testes de stale e de janela de 24 h.
 */
export function createServer(pool, { now = () => new Date() } = {}) {
  async function route(url) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api') throw new HttpError(404, 'rota não encontrada');
    const [, a, b, c] = parts;
    const q = url.searchParams;
    if (parts.length === 2 && a === 'health') return health(pool, now());
    if (parts.length === 2 && a === 'locations') return listLocations(pool);
    if (parts.length === 4 && a === 'locations') {
      if (c === 'summary') return summary(pool, b, now());
      if (c === 'hourly') return hourly(pool, b, q.get('hours'), now());
      if (c === 'daily') return daily(pool, b, now());
    }
    throw new HttpError(404, 'rota não encontrada');
  }

  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'método não permitido' });
    try {
      send(200, await route(new URL(req.url, 'http://localhost')));
    } catch (err) {
      if (err instanceof HttpError) return send(err.status, { error: err.message });
      console.error('[backend] erro inesperado:', err);
      send(500, { error: 'erro interno' });
    }
  });
}
