export const BACKOFF_MS = [2000, 5000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Executa fn; em erro retryable repete até backoff.length vezes. */
export async function withRetry(fn, { backoff = BACKOFF_MS, wait = sleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!err.retryable || attempt >= backoff.length) throw err;
      await wait(backoff[attempt]);
    }
  }
}
