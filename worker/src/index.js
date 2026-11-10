import { createPool } from '@weatherops/db';
import { runAll } from './run-all.js';
import { runObservedAll } from './observed.js';

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

async function observedCycle() {
  try {
    const { skipped, results } = await runObservedAll(pool);
    if (skipped) return log('observado: execução já em andamento; ignorada');
    for (const r of results) {
      log(`observado ${r.location}: ${r.status}${r.days != null ? ` (${r.days} dias)` : ''}${r.error ? ` - ${r.error}` : ''}`);
    }
  } catch (err) {
    log(`erro inesperado no job do observado: ${err.message}`);
  }
}

// Próximas 03:00 em America/Sao_Paulo (UTC-3, sem horário de verão desde 2019) = 06:00 UTC.
function msUntilNextObserved(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(6, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

function scheduleObserved() {
  const delay = msUntilNextObserved();
  log(`próximo job do observado em ${Math.round(delay / 60000)} min`);
  setTimeout(async () => {
    await observedCycle();
    scheduleObserved();
  }, delay);
}

log('iniciando; coleta imediata');
await cycle();
scheduleNext();
await observedCycle();
scheduleObserved();
