# WeatherOps — Especificação do MVP

> Versão 1.0 · Status: rascunho para validação com o cliente

## 1. Objetivo

Painel web que mostra condições e previsão do tempo para até 3 locais configuráveis (Santos no MVP). Os dados vêm da Open-Meteo Forecast API, são coletados por um job agendado a cada 30 minutos e ficam guardados em PostgreSQL. Dias que passam dos limites de risco configurados aparecem destacados.

O sistema **apenas apresenta dados e aplica regras configuradas**. Ele não gera recomendações meteorológicas, como "leve guarda-chuva" ou "evite a praia".

## 2. Escopo

### Dentro do MVP
- Coleta automática a cada 30 min
- Até 3 locais configuráveis por latitude/longitude, com Santos como padrão
- Indicadores atuais, previsão de 7 dias e gráficos horários
- Destaque de dias de risco por regras configuráveis
- Fallback para o último dado válido quando a API falhar
- Histórico de 30 dias para comparar previsão com o observado

### Fora do MVP
- Login / multiusuário
- Notificações (e-mail, push, WhatsApp)
- Busca de cidade por nome (geocoding)
- Edição de locais e regras pela interface (no MVP a configuração fica em arquivo ou tabela)
- Outras fontes de dados além da Open-Meteo

## 3. Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js (App Router) |
| Backend / API | Node.js **ou** FastAPI *(decidir; ver §12)* |
| Banco | PostgreSQL |
| Coleta | Job agendado (cron) a cada 30 min |

### Arquitetura

```
┌──────────────┐  a cada 30 min  ┌────────────────┐
│ Job de coleta│ ───────────────▶│ Open-Meteo API │
└──────┬───────┘                 └────────────────┘
       │ grava snapshot
       ▼
┌──────────────┐     lê      ┌──────────────┐    HTTP    ┌──────────────┐
│  PostgreSQL  │ ◀────────── │  API backend │ ◀───────── │  Next.js UI  │
└──────────────┘             └──────────────┘            └──────────────┘
```

**Regra de arquitetura:** o frontend **nunca** chama a Open-Meteo diretamente. Tudo é lido do banco, e é isso que garante o fallback (§7).

## 4. Fonte de dados

**Endpoint:** `GET https://api.open-meteo.com/v1/forecast`

### Parâmetros

| Parâmetro | Valor |
|---|---|
| `latitude`, `longitude` | do local configurado |
| `current` | `temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code` |
| `hourly` | `temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,weather_code` |
| `daily` | `temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code` |
| `forecast_days` | `7` |
| `timezone` | `America/Sao_Paulo` |
| `temperature_unit` | `celsius` |
| `wind_speed_unit` | `kmh` |
| `precipitation_unit` | `mm` |

### Exemplo (Santos)

```
https://api.open-meteo.com/v1/forecast?latitude=-23.9608&longitude=-46.3336
&current=temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code
&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,weather_code
&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code
&forecast_days=7&timezone=America%2FSao_Paulo&wind_speed_unit=kmh
```

> As unidades devem ser passadas explicitamente, mesmo quando forem o padrão da API, para não depender de defaults.

## 5. Modelo de dados

### `locations`
| Coluna | Tipo | Observação |
|---|---|---|
| id | serial PK | |
| name | text | ex.: "Santos" |
| latitude | numeric(8,5) | |
| longitude | numeric(8,5) | |
| timezone | text | default `America/Sao_Paulo` |
| active | boolean | default `true` |
| created_at | timestamptz | |

Restrição: no máximo **3** locais com `active = true`, validado na aplicação.

### `fetch_runs` (cada execução do job)
| Coluna | Tipo | Observação |
|---|---|---|
| id | bigserial PK | |
| location_id | FK → locations | |
| started_at | timestamptz | |
| finished_at | timestamptz | |
| status | text | `success` \| `error` |
| http_status | int | nulo se não houve resposta |
| error_message | text | |
| raw_payload | jsonb | resposta bruta da API (só em sucesso) |

### `current_conditions`
| Coluna | Tipo |
|---|---|
| fetch_run_id | FK → fetch_runs |
| location_id | FK |
| observed_at | timestamptz (campo `current.time` da API) |
| temperature_2m | numeric |
| apparent_temperature | numeric |
| precipitation | numeric |
| wind_speed_10m | numeric |
| weather_code | int |

### `hourly_forecast`
| Coluna | Tipo |
|---|---|
| fetch_run_id | FK → fetch_runs |
| location_id | FK |
| forecast_time | timestamptz |
| temperature_2m | numeric |
| apparent_temperature | numeric |
| precipitation_probability | int |
| precipitation | numeric |
| wind_speed_10m | numeric |
| weather_code | int |

Índice: `(location_id, fetch_run_id, forecast_time)`

### `daily_forecast`
| Coluna | Tipo |
|---|---|
| fetch_run_id | FK → fetch_runs |
| location_id | FK |
| forecast_date | date |
| temperature_max | numeric |
| temperature_min | numeric |
| precipitation_sum | numeric |
| precipitation_probability_max | int |
| wind_speed_max | numeric |
| weather_code | int |
| is_risk | boolean |
| risk_reasons | text[] | ex.: `{rain_probability, wind}` |

### `risk_rules`
| Coluna | Tipo | Valor inicial |
|---|---|---|
| key | text PK | |
| threshold | numeric | |
| unit | text | |
| active | boolean | |

Valores iniciais:

| key | threshold | unit |
|---|---|---|
| `rain_probability` | 60 | % |
| `precipitation_daily` | 5 | mm |
| `wind_speed` | 35 | km/h |

### Por que guardar snapshots
Cada coleta grava **novas linhas** vinculadas a um `fetch_run`, sem sobrescrever as anteriores. Assim, depois que um dia passa, dá para comparar o que foi previsto para ele em diferentes momentos com o que foi observado (§8).

## 6. Job de coleta

- **Frequência:** a cada 30 min (`*/30 * * * *`)
- **Para cada local ativo:**
  1. Criar `fetch_runs` com `status = running`
  2. Chamar a API com timeout de **10 s**
  3. Em caso de erro (timeout, 5xx, 429), tentar de novo **até 2 vezes** com backoff (2 s, 5 s)
  4. Validar o payload: os blocos `current`, `hourly` e `daily` precisam existir e não podem estar vazios
  5. Gravar `current_conditions`, `hourly_forecast` e `daily_forecast` **em uma única transação**
  6. Calcular `is_risk` / `risk_reasons` para cada dia (§9)
  7. Atualizar `fetch_runs.status` para `success` ou `error`
- Uma falha em um local **não** impede a coleta dos outros.
- O job precisa ser idempotente: duas execuções simultâneas não podem corromper dados (usar lock, por exemplo `pg_advisory_lock`).

## 7. Fallback (último dado válido)

- A API do backend sempre devolve o **snapshot mais recente com `status = success`**.
- Se a última coleta falhou, a resposta inclui `stale: true` e a interface mostra um aviso, por exemplo:
  > ⚠️ Não foi possível atualizar. Exibindo dados de 04/11 às 21:00.
- Considerar o dado **desatualizado** quando `last_success_at` tiver mais de 60 min (2 ciclos perdidos).
- Se nunca houve uma coleta bem-sucedida para o local, mostrar um estado vazio com a mensagem "Ainda sem dados".

## 8. Histórico e retenção

- Guardar **30 dias** de snapshots.
- Rotina diária de limpeza: apagar `fetch_runs` (e os dados ligados a eles, em cascata) com `started_at` de mais de 30 dias.
- **Previsão × observado:** para cada data passada, comparar
  - o `daily_forecast` previsto D-1 (o snapshot mais próximo de 24h antes) com
  - os valores observados, calculados a partir do `current_conditions` daquele dia (máx/mín de temperatura, soma de precipitação, vento máximo).

> **Atualização (Fase 5):** o observado não vem mais de `current_conditions`. Um job diário (03:00, America/Sao_Paulo) busca a Historical API com `models=era5` e faz upsert em `observed_daily`, que não expira. Trata-se de **reanálise** (dado de modelo, não medição de estação) com defasagem de cerca de 7 dias; dias sem dado ficam "observado indisponível". Sem `models`, a API devolveria o dia corrente incompleto (ver `docs/05-validacao-api.md`).

**Volume estimado:** 3 locais × 48 coletas/dia × 30 dias = 4.320 snapshots. Com ~168 linhas horárias cada, são ~726 mil linhas em `hourly_forecast`, o que o PostgreSQL suporta sem dificuldade.

## 9. Regras de destaque de risco

Um dia é marcado como **risco** se **qualquer** regra ativa for atingida:

| Regra | Condição | Campo |
|---|---|---|
| Chance de chuva | ≥ 60% | `precipitation_probability_max` |
| Chuva no dia | ≥ 5 mm | `precipitation_sum` |
| Vento | ≥ 35 km/h | `wind_speed_10m_max` |

- Os limites ficam em `risk_rules`, nunca fixos no código.
- A interface mostra **qual** regra disparou, por exemplo: "Chuva ≥ 60% · Vento ≥ 35 km/h".
- O texto exibido descreve só a regra e o valor. Nada de recomendação.

## 10. API do backend

Todas as respostas trazem `last_updated_at` e `stale`.

**Convenções implementadas (Fase 3)**
- Respostas por local também trazem `has_data` (`false` = estado "Ainda sem dados": `last_updated_at: null`, `stale: true`, `current`/`today` nulos, listas vazias; sempre HTTP 200).
- `last_updated_at` é o fim do último `fetch_run` com sucesso, em ISO 8601 com o offset do fuso do local; `stale` é `true` quando passou mais de 60 min.
- A janela de `next_24h_max_precipitation_probability` vai da hora cheia em curso até `agora + 24h`; `today` é o dia civil inteiro no fuso do local.
- `hourly` começa na hora cheia atual; `hours` padrão 48, máximo 168, valor inválido retorna 400. Local inexistente ou inativo retorna 404; métodos diferentes de GET, 405.
- `/api/health` devolve, por local, `last_run` (qualquer status, ou `null`), `last_updated_at` e `stale`.

### `GET /api/locations`
Lista os locais ativos.

### `GET /api/locations/:id/summary`
Indicadores do topo.
```json
{
  "location": { "id": 1, "name": "Santos" },
  "last_updated_at": "2026-11-04T21:30:00-03:00",
  "stale": false,
  "current": {
    "temperature": 24.1,
    "apparent_temperature": 26.3,
    "weather_code": 3
  },
  "next_24h_max_precipitation_probability": 70,
  "today": {
    "precipitation_sum": 6.2,
    "wind_speed_max": 28.4,
    "temperature_min": 19.8,
    "temperature_max": 27.5
  }
}
```
`next_24h_max_precipitation_probability` = maior `precipitation_probability` entre as horas de `agora` e `agora + 24h`.

### `GET /api/locations/:id/hourly?hours=48`
Série horária para os gráficos (temperatura e chuva).

### `GET /api/locations/:id/daily`
Previsão de 7 dias com `is_risk` e `risk_reasons`.

### `GET /api/locations/:id/history?days=30`
Previsão D-1 × observado por dia, do dia anterior a hoje para trás, mais recente primeiro. `days` vai de 1 a 30 (padrão 30; inválido retorna 400).

```json
{
  "location": { "id": 1, "name": "Santos" },
  "last_updated_at": "2026-11-10T14:55:02-03:00",
  "stale": false,
  "has_data": true,
  "days": 30,
  "observed_source": "reanalysis",
  "history": [
    {
      "date": "2026-11-03",
      "forecast": { "temperature_max": 30.1, "temperature_min": 21.0, "precipitation_sum": 2.0, "wind_speed_max": 30.0 },
      "observed": { "temperature_max": 32.9, "temperature_min": 22.4, "precipitation_sum": 0.0, "wind_speed_max": 18.3 },
      "observed_status": "available",
      "difference": { "temperature_max": 2.8, "temperature_min": 1.4, "precipitation_sum": -2.0, "wind_speed_max": -11.7 },
      "coverage_pct": 100
    }
  ]
}
```

- `forecast`: `daily_forecast` do snapshot com sucesso mais próximo de 24 h antes do início do dia (00:00 do dia anterior, no fuso do local), a no máximo 12 h de distância; `null` se não houver.
- `observed`: linha de `observed_daily` (Historical API com `models=era5`, reanálise); `null` quando ainda não há dado, com `observed_status: "unavailable"`.
- `difference` = observado − previsto; `null` se faltar um dos lados.
- `coverage_pct` = coletas com sucesso no dia anterior ÷ 48, limitado a 100. Abaixo de 100 a tela mostra "cobertura parcial".

### `GET /api/health`
Status do último `fetch_run` de cada local.

## 11. Frontend

### Layout da tela principal
1. **Cabeçalho:** seletor de local (até 3) e "Última atualização: dd/mm às hh:mm", com aviso se `stale`
2. **Cards de indicadores:**
   - Temperatura atual (°C)
   - Sensação térmica (°C)
   - Maior chance de chuva nas próximas 24h (%)
   - Precipitação prevista hoje (mm)
   - Vento máximo hoje (km/h)
   - Mínima / máxima de hoje (°C)
3. **Gráfico:** temperatura por hora (linha)
4. **Gráfico:** chuva por hora (barras em mm + linha de probabilidade em %)
5. **Previsão de 7 dias:** um card por dia com ícone (`weather_code`), mín/máx, chuva e vento. Os dias de risco ganham destaque visual e mostram a regra que disparou.

### Requisitos
- Unidades sempre visíveis: °C, mm, km/h
- Datas e horas em `America/Sao_Paulo`, formato pt-BR
- Ícone e descrição a partir de uma tabela de mapeamento dos códigos WMO (`weather_code`)
- Responsivo (desktop e celular)
- Atualizar os dados na tela a cada 5 min (revalidação) sem recarregar a página

## 12. Decisões em aberto

| # | Decisão | Opções |
|---|---|---|
| 1 | Backend | Node.js (mesma linguagem do Next) **ou** FastAPI |
| 2 | Onde roda o job | cron do sistema, worker separado, pg_cron ou cron do provedor (ex.: Vercel Cron) |
| 3 | Hospedagem | a definir |
| 4 | Cadastro de locais no MVP | seed/arquivo de config **ou** tela simples de admin |
| 5 | "Hoje" no card de precipitação | dia civil inteiro (00h–23h) **ou** só as horas restantes |
| 6 | Histórico na interface | só via API no MVP **ou** já com uma tela de comparação |

## 13. Critérios de aceite

- [ ] Com o job rodando, uma nova coleta aparece no banco a cada 30 min (± 1 min)
- [ ] O painel mostra todos os indicadores da §11 para Santos, com unidades corretas
- [ ] Os gráficos de temperatura e chuva por hora são exibidos
- [ ] A previsão de 7 dias mostra mín/máx por dia
- [ ] Um dia com chance de chuva ≥ 60%, chuva ≥ 5 mm ou vento ≥ 35 km/h aparece destacado, com o motivo
- [ ] Mudar um limite em `risk_rules` muda o destaque na coleta seguinte, sem deploy
- [ ] Com a API indisponível (simulada), o painel continua mostrando o último dado válido e o aviso de desatualização
- [ ] O horário da última atualização bem-sucedida está sempre visível
- [ ] Dá para cadastrar até 3 locais; um 4º local ativo é recusado
- [ ] Dados com mais de 30 dias são removidos pela rotina de limpeza
- [ ] Nenhum texto da interface faz recomendação meteorológica
