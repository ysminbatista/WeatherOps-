import { createPool } from '@weatherops/db';
import { runAll } from './run-all.js';

const INTERVAL_MS = 30 * 60 * 1000;
const pool = createPool();

const log = (msg) => console.log(`[worker] ${new Date().toISOString()} ${msg}`);

async function cycle() {
  try {
    const { skipped, results } = await runAll(pool);
    if (skipped) return log('coleta já em andamento; ciclo ignorado');
    for (const r of results) {
      log(`${r.location}: ${r.status} (run ${r.runId})${r.error ? ` - ${r.error}` : ''}`);
    }
    if (!results.length) log('nenhum local ativo');
  } catch (err) {
    log(`erro inesperado no ciclo: ${err.message}`);
  }
}

// Alinhado a :00 e :30 do relógio.
function scheduleNext() {
  const delay = INTERVAL_MS - (Date.now() % INTERVAL_MS);
  log(`próxima coleta em ${Math.round(delay / 1000)} s`);
  setTimeout(async () => {
    await cycle();
    scheduleNext();
  }, delay);
}

log('iniciando; coleta imediata');
await cycle();
scheduleNext();
