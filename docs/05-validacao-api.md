# Validação das APIs Open-Meteo

> Gerado por `scripts/validate-api.mjs` em 2026-11-05T23:06:10.006Z para Santos (-23.9608, -46.3336).

## Forecast API

- **Host:** `https://api.open-meteo.com/v1/forecast`
- **Status HTTP:** 200 (1368 ms)
- **URL usada:** `https://api.open-meteo.com/v1/forecast?latitude=-23.9608&longitude=-46.3336&current=temperature_2m%2Capparent_temperature%2Cprecipitation%2Cwind_speed_10m%2Cweather_code&hourly=temperature_2m%2Capparent_temperature%2Cprecipitation_probability%2Cprecipitation%2Cwind_speed_10m%2Cweather_code&daily=temperature_2m_max%2Ctemperature_2m_min%2Cprecipitation_sum%2Cprecipitation_probability_max%2Cwind_speed_10m_max%2Cweather_code&forecast_days=7&timezone=America%2FSao_Paulo&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm`
- **`forecast_days=7` confirmado:** sim — `daily.time` tem 7 dias (2026-11-05 a 2026-11-11)
- **Horas em `hourly.time`:** 168
- **Unidades devolvidas:** `{"time":"iso8601","temperature_2m_max":"°C","temperature_2m_min":"°C","precipitation_sum":"mm","precipitation_probability_max":"%","wind_speed_10m_max":"km/h","weather_code":"wmo code"}`
- **Fuso devolvido:** America/Sao_Paulo

Trecho da resposta (3 primeiros itens de cada série):

```json
{
  "current": {
    "time": "2026-11-05T20:00",
    "interval": 900,
    "temperature_2m": 24,
    "apparent_temperature": 28.9,
    "precipitation": 0.1,
    "wind_speed_10m": 1.2,
    "weather_code": 51
  },
  "current_units": {
    "time": "iso8601",
    "interval": "seconds",
    "temperature_2m": "°C",
    "apparent_temperature": "°C",
    "precipitation": "mm",
    "wind_speed_10m": "km/h",
    "weather_code": "wmo code"
  },
  "hourly": {
    "time": [
      "2026-11-05T00:00",
      "2026-11-05T01:00",
      "2026-11-05T02:00"
    ],
    "temperature_2m": [
      23.3,
      23.3,
      23.3
    ],
    "apparent_temperature": [
      27.8,
      27.7,
      27.9
    ],
    "precipitation_probability": [
      100,
      77,
      35
    ],
    "precipitation": [
      0,
      0,
      0
    ],
    "wind_speed_10m": [
      4.5,
      3.6,
      3.5
    ],
    "weather_code": [
      3,
      3,
      3
    ]
  },
  "daily": {
    "time": [
      "2026-11-05",
      "2026-11-06",
      "2026-11-07"
    ],
    "temperature_2m_max": [
      27.9,
      24.6,
      30.3
    ],
    "temperature_2m_min": [
      23,
      21.7,
      21
    ],
    "precipitation_sum": [
      7,
      10,
      5.9
    ],
    "precipitation_probability_max": [
      100,
      98,
      60
    ],
    "wind_speed_10m_max": [
      11.1,
      12.1,
      22.7
    ],
    "weather_code": [
      81,
      81,
      96
    ]
  }
}
```

## Historical API

- **Host:** `https://archive-api.open-meteo.com/v1/archive`
- **Status HTTP:** 200 (1436 ms)
- **URL usada:** `https://archive-api.open-meteo.com/v1/archive?latitude=-23.9608&longitude=-46.3336&start_date=2026-10-22&end_date=2026-11-05&daily=temperature_2m_max%2Ctemperature_2m_min%2Cprecipitation_sum%2Cwind_speed_10m_max&timezone=America%2FSao_Paulo&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm`
- **Parâmetros:** `latitude`, `longitude`, `start_date`, `end_date`, `daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max`, `timezone`, mais as unidades explícitas
- **Janela pedida:** 2026-10-22 a 2026-11-05 (hoje, UTC)
- **Dias com dado:** 15 de 15
- **Dia mais recente com dado:** 2026-11-05
- **Defasagem observada:** 0 dia(s) entre hoje e o dado mais recente
- **Dias retornados com `null`:** nenhum

Trecho da resposta (últimos 7 dias da janela):

```json
{
  "daily_units": {
    "time": "iso8601",
    "temperature_2m_max": "°C",
    "temperature_2m_min": "°C",
    "precipitation_sum": "mm",
    "wind_speed_10m_max": "km/h"
  },
  "daily": {
    "time": [
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05"
    ],
    "temperature_2m_max": [
      23.5,
      24.1,
      26.2,
      29.1,
      29.8,
      27.2,
      27.6
    ],
    "temperature_2m_min": [
      20.3,
      19,
      19.1,
      21.5,
      21.3,
      21.9,
      23
    ],
    "precipitation_sum": [
      4.1,
      1,
      1.1,
      5.2,
      0,
      1.1,
      7
    ],
    "wind_speed_10m_max": [
      19.9,
      10.8,
      7.4,
      15.1,
      11.9,
      11.4,
      11.1
    ]
  }
}
```

## Historical API com `models=era5` (reanálise pura)

- **Dia mais recente com dado:** 2026-10-29
- **Defasagem:** 7 dia(s)
- **Dias com `null`:** 2026-10-30, 2026-10-31, 2026-11-01, 2026-11-02, 2026-11-03, 2026-11-04, 2026-11-05

> **Divergência do esperado (R9/R10):** sem o parâmetro `models`, a API usa "best match" e devolve valores até o dia de hoje (inclusive o dia incompleto), misturando modelos de análise quase em tempo real. Só com `models=era5` aparece a defasagem típica de reanálise. A escolha entre os dois muda o que a tela de comparação chama de "observado" e precisa de decisão antes da Fase 5.

## Conclusões para as Fases 5 e 6

- A Historical API devolve `null` (não erro) para dias ainda sem dado: o job do observado deve gravar só dias com valor e o endpoint de histórico deve tratar os demais como `unavailable`.
- Defasagem medida: 0 dia(s).
