// Chama a Forecast API e a Historical API para Santos e gera docs/05-validacao-api.md.
import { writeFile } from 'node:fs/promises';

const LAT = -23.9608;
const LON = -46.3336;
const TZ = 'America/Sao_Paulo';
const DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max';

const forecastParams = new URLSearchParams({
  latitude: LAT, longitude: LON,
  current: 'temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code',
  hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,weather_code',
  daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code',
  forecast_days: 7, timezone: TZ,
  temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm',
});

const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const start = new Date(today); start.setUTCDate(start.getUTCDate() - 14);
const histParams = new URLSearchParams({
  latitude: LAT, longitude: LON, start_date: iso(start), end_date: iso(today),
  daily: DAILY, timezone: TZ,
  temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm',
});

async function get(url) {
  const t0 = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  return { status: res.status, ms: Date.now() - t0, url, body: await res.json() };
}

const forecast = await get(`https://api.open-meteo.com/v1/forecast?${forecastParams}`);
const hist = await get(`https://archive-api.open-meteo.com/v1/archive?${histParams}`);

const era5Params = new URLSearchParams(histParams);
era5Params.set('models', 'era5');
const era5 = await get(`https://archive-api.open-meteo.com/v1/archive?${era5Params}`);
const ed = era5.body.daily;
const era5Days = ed.time.filter((_, i) => ed.temperature_2m_max[i] !== null);
const era5Latest = era5Days.at(-1);
const era5Lag = era5Latest ? Math.round((Date.parse(iso(today)) - Date.parse(era5Latest)) / 86400000) : null;
const era5Nulls = ed.time.filter((_, i) => ed.temperature_2m_max[i] === null);

const fd = forecast.body.daily;
const hd = hist.body.daily;
const nonNull = hd.time.filter((_, i) => hd.temperature_2m_max[i] !== null);
const latestWithData = nonNull.at(-1);
const nullDays = hd.time.filter((_, i) => hd.temperature_2m_max[i] === null);
const lagDays = latestWithData
  ? Math.round((Date.parse(iso(today)) - Date.parse(latestWithData)) / 86400000) : null;

const cut = (obj, n = 3) => JSON.stringify(obj, (k, v) => (Array.isArray(v) ? v.slice(0, n) : v), 2);

const md = `# Validação das APIs Open-Meteo

> Gerado por \`scripts/validate-api.mjs\` em ${today.toISOString()} para Santos (${LAT}, ${LON}).

## Forecast API

- **Host:** \`https://api.open-meteo.com/v1/forecast\`
- **Status HTTP:** ${forecast.status} (${forecast.ms} ms)
- **URL usada:** \`${forecast.url}\`
- **\`forecast_days=7\` confirmado:** ${fd.time.length === 7 ? 'sim' : 'NÃO'} — \`daily.time\` tem ${fd.time.length} dias (${fd.time[0]} a ${fd.time.at(-1)})
- **Horas em \`hourly.time\`:** ${forecast.body.hourly.time.length}
- **Unidades devolvidas:** \`${JSON.stringify(forecast.body.daily_units)}\`
- **Fuso devolvido:** ${forecast.body.timezone}

Trecho da resposta (3 primeiros itens de cada série):

\`\`\`json
${cut({ current: forecast.body.current, current_units: forecast.body.current_units, hourly: forecast.body.hourly, daily: forecast.body.daily })}
\`\`\`

## Historical API

- **Host:** \`https://archive-api.open-meteo.com/v1/archive\`
- **Status HTTP:** ${hist.status} (${hist.ms} ms)
- **URL usada:** \`${hist.url}\`
- **Parâmetros:** \`latitude\`, \`longitude\`, \`start_date\`, \`end_date\`, \`daily=${DAILY}\`, \`timezone\`, mais as unidades explícitas
- **Janela pedida:** ${iso(start)} a ${iso(today)} (hoje, UTC)
- **Dias com dado:** ${nonNull.length} de ${hd.time.length}
- **Dia mais recente com dado:** ${latestWithData ?? 'nenhum'}
- **Defasagem observada:** ${lagDays === null ? 'indeterminada' : `${lagDays} dia(s) entre hoje e o dado mais recente`}
- **Dias retornados com \`null\`:** ${nullDays.length ? nullDays.join(', ') : 'nenhum'}

Trecho da resposta (últimos 7 dias da janela):

\`\`\`json
${JSON.stringify({ daily_units: hist.body.daily_units, daily: Object.fromEntries(Object.entries(hd).map(([k, v]) => [k, v.slice(-7)])) }, null, 2)}
\`\`\`

## Historical API com \`models=era5\` (reanálise pura)

- **Dia mais recente com dado:** ${era5Latest ?? 'nenhum'}
- **Defasagem:** ${era5Lag === null ? 'indeterminada' : `${era5Lag} dia(s)`}
- **Dias com \`null\`:** ${era5Nulls.join(', ') || 'nenhum'}

> **Divergência do esperado (R9/R10):** sem o parâmetro \`models\`, a API usa "best match" e devolve valores até o dia de hoje (inclusive o dia incompleto), misturando modelos de análise quase em tempo real. Só com \`models=era5\` aparece a defasagem típica de reanálise. A escolha entre os dois muda o que a tela de comparação chama de "observado" e precisa de decisão antes da Fase 5.

## Conclusões para as Fases 5 e 6

- A Historical API devolve \`null\` (não erro) para dias ainda sem dado: o job do observado deve gravar só dias com valor e o endpoint de histórico deve tratar os demais como \`unavailable\`.
- Defasagem medida: ${lagDays === null ? 'indeterminada' : `${lagDays} dia(s)`}.
`;

await writeFile(new URL('../docs/05-validacao-api.md', import.meta.url), md);
console.log(`forecast ${forecast.status}, dias=${fd.time.length}; histórico ${hist.status}, último dado=${latestWithData}, defasagem=${lagDays}`);
