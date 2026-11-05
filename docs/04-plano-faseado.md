# WeatherOps — Plano Faseado

> Documento 4 de 4. Base: [spec.md](../spec.md), [01-prompt-guide.md](01-prompt-guide.md), [02-discovery.md](02-discovery.md), [03-impactos.md](03-impactos.md).
> Cada fase é **um prompt inteiro**, termina com algo **demonstrável e testável** e só começa depois da revisão da anterior.

## 1. Visão geral

| Fase | Nome | Entrega demonstrável | Esforço | Depende de |
|---|---|---|---|---|
| 1 | Base, banco e validação da API | `docker compose up` sobe o Postgres com schema e seed; chamada real à Open-Meteo documentada | 7–11 h | — |
| 2 | Job de coleta da previsão | Nova coleta no banco a cada 30 min, com retry, lock e risco calculado | 8–13 h | 1 |
| 3 | API do backend | Endpoints respondendo com dados reais, `stale` e fallback | 6–10 h | 2 |
| 4 | Painel principal | Tela completa de indicadores, gráficos e 7 dias com risco | 11–18 h | 3 |
| 5 | Observado e comparação | Tabela previsto × observado por dia, com cobertura e indisponível | 12–18 h | 2, 3, 4 |
| 6 | Retenção, fechamento e documentação | Limpeza de 30 dias, checklist do spec fechado, README | 3–4 h | 1–5 |
| | **Total** | | **47–74 h** | |

O total difere em ±1 h do documento de impactos (45–73 h) por arredondamento ao distribuir os itens. Os testes de cada fase estão dentro do esforço dela.

```
Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5 → Fase 6
```

### Regras para todas as fases
- Ler o `spec.md` e o `01-prompt-guide.md` antes de começar.
- Obedecer às regras fixas (guia, seção 2) e às decisões fechadas (guia, seção 1).
- Antes de codar: apresentar o plano da fase (arquivos, ordem, riscos) e aguardar aprovação.
- Ao final: rodar os testes, mostrar a saída real, listar arquivos alterados, pendências e suposições.
- Pré-requisito: rodar `git init` e fazer um commit inicial, para poder desfazer uma fase inteira.

---

## Fase 1 — Base, banco e validação da API

**Objetivo:** ter o ambiente reproduzível e o schema completo, e confirmar com chamadas reais o que o spec só presume (inclusive a defasagem da Historical API).

**Escopo**
- Estrutura do projeto: frontend (Next.js), backend (Node.js), worker (Node.js)
- `docker-compose.yml` com Postgres (volume nomeado), backend, worker e frontend; arquivo `.env.example`
- Migrations versionadas com todas as tabelas do spec §5 mais `observed_daily`; cascata a partir de `fetch_runs`; índice `(location_id, fetch_run_id, forecast_time)`
- Seed: Santos, mais 2 locais de teste (ex.: São Paulo, Rio de Janeiro); 3 regras de `risk_rules` com os valores iniciais
- Validação no código de no máximo 3 locais ativos
- Chamada real à Forecast API (confirmar `forecast_days=7`) e à Historical API (confirmar host, parâmetros e defasagem); resultados em `docs/05-validacao-api.md`

**Fora de escopo:** job agendado, endpoints, telas, retenção.

**Critérios de aceite**
- [ ] `docker compose up` sobe o Postgres e aplica as migrations sem erro
- [ ] O seed cria 3 locais e 3 regras; rodar o seed duas vezes não duplica nada
- [ ] Tentar ativar um 4º local é recusado
- [ ] `docs/05-validacao-api.md` registra a resposta real das duas APIs e a defasagem da Historical API
- [ ] Testes de schema e de seed passando

**Esforço:** 7–11 h · **Risco:** baixo. Se a Historical API se comportar diferente do esperado (R9, R10), ajustar o desenho das Fases 5 e 6 **antes** de seguir.

<details><summary>Prompt</summary>

```
Fase 1 de 6 — Base, banco e validação da API

Contexto
- Leia spec.md e docs/01-prompt-guide.md (regras fixas e decisões fechadas) e docs/03-impactos.md.
- Estado atual: só existem os documentos; nenhum código.

Objetivo
Criar o ambiente em Docker Compose, o schema completo do banco e o seed, e validar com chamadas reais as duas APIs da Open-Meteo.

Escopo
- Projeto com frontend Next.js, backend Node.js e worker Node.js.
- Docker Compose com Postgres (volume nomeado), .env.example.
- Migrations versionadas: todas as tabelas do spec §5 + observed_daily (local, data, temperatura máx/mín, precipitação, vento máx, fetched_at; chave única local+data). Cascata de fetch_runs para as filhas.
- Seed idempotente: Santos + 2 locais de teste; as 3 regras de risk_rules.
- Regra de no máximo 3 locais ativos, validada na aplicação.
- Script que chama a Forecast API e a Historical API para Santos, e documento docs/05-validacao-api.md com: parâmetros usados, trecho da resposta, confirmação de forecast_days=7, host e parâmetros da Historical API e a defasagem real dos dados mais recentes.

Fora de escopo
- Job agendado, endpoints, telas, retenção, qualquer item de "Fora do MVP".

Critérios de aceite
- docker compose up sobe tudo e aplica migrations.
- Seed idempotente.
- 4º local ativo é recusado.
- docs/05-validacao-api.md preenchido com dados reais.
- Testes de schema e seed passando.

Entrega
- Plano da fase primeiro, para aprovação. Depois implementação.
- Saída dos testes, arquivos criados, pendências e suposições.
- Se a Historical API divergir do esperado, pare e me avise antes de seguir.
```
</details>

---

## Fase 2 — Job de coleta da previsão

**Objetivo:** gravar snapshots da previsão a cada 30 min, de forma resiliente e idempotente, já com risco calculado.

**Escopo** (spec §6, §9)
- Worker agendado a cada 30 min **e uma coleta imediata ao subir**
- Por local ativo: `fetch_runs` → chamada com timeout de 10 s → até 2 retries (2 s e 5 s) em timeout, 5xx e 429 → validação do payload (`current`, `hourly`, `daily` presentes e não vazios) → gravação em **uma transação** → cálculo de `is_risk` e `risk_reasons` lendo `risk_rules` → fechamento do run
- Falha em um local não bloqueia os outros
- `pg_advisory_lock` contra execuções simultâneas
- Camada única de acesso à Open-Meteo (facilita simulação e testes de contrato)
- Unidades passadas explicitamente na chamada

**Fora de escopo:** endpoints, telas, job do observado, retenção.

**Critérios de aceite**
- [ ] Após subir o worker há uma coleta imediata e depois uma nova a cada 30 min (± 1 min)
- [ ] Com API simulada: timeout, 5xx, 429 e payload vazio geram `status = error`, sem gravar dados parciais
- [ ] Falha em um local não impede os outros
- [ ] Duas execuções simultâneas não duplicam nem corrompem dados
- [ ] Mudar um limite em `risk_rules` muda `is_risk` na coleta seguinte, sem deploy
- [ ] Nenhum limite fixo no código

**Esforço:** 8–13 h · **Risco:** médio (R2, R6).

<details><summary>Prompt</summary>

```
Fase 2 de 6 — Job de coleta da previsão

Contexto
- Leia spec.md (§4, §5, §6, §9) e docs/01-prompt-guide.md. A Fase 1 está aprovada: ambiente, schema, seed e docs/05-validacao-api.md existem.

Objetivo
Worker que coleta a previsão de todos os locais ativos a cada 30 min e grava snapshots com risco calculado.

Escopo
- Agendamento */30 e uma coleta imediata ao subir o worker.
- Fluxo do spec §6 passo a passo (fetch_run, timeout 10 s, 2 retries com backoff 2 s/5 s em timeout/5xx/429, validação de payload, transação única, risco, fechamento do run).
- Falha em um local não bloqueia os demais.
- pg_advisory_lock contra concorrência.
- Cliente da Open-Meteo isolado em um único módulo; unidades explícitas (°C, km/h, mm) e timezone America/Sao_Paulo.
- Risco lido de risk_rules (nunca fixo), gravando is_risk e risk_reasons.

Fora de escopo
- Endpoints, telas, job do observado, retenção.

Critérios de aceite
- Coleta imediata + a cada 30 min.
- API simulada (timeout, 5xx, 429, payload vazio) => status error e nenhuma linha parcial.
- Local com falha não afeta os outros.
- Concorrência testada.
- Alterar risk_rules muda o risco na coleta seguinte.

Entrega
- Plano primeiro, para aprovação.
- Testes com API simulada (não a real) + uma coleta real mostrada no banco.
- Saída dos testes, arquivos, pendências e suposições.
```
</details>

---

## Fase 3 — API do backend

**Objetivo:** expor os dados do banco com fallback e indicação de desatualizado. O frontend só falará com esta API.

**Escopo** (spec §7, §10)
- `GET /api/locations`, `/locations/:id/summary`, `/hourly?hours=48`, `/daily`, `GET /api/health`
- Função única que devolve o snapshot mais recente com `status = success`; reutilizada por todos os endpoints
- Todas as respostas com `last_updated_at` e `stale` (`true` quando o último sucesso tem mais de 60 min)
- Local sem nenhuma coleta bem-sucedida: resposta que permita o estado "Ainda sem dados"
- `next_24h_max_precipitation_probability` e `today` (dia civil inteiro) calculados conforme o spec
- Índice adicional em `fetch_runs(location_id, started_at)` se o `EXPLAIN` justificar

**Fora de escopo:** endpoint `history` (Fase 5), telas.

**Critérios de aceite**
- [ ] Os 5 endpoints respondem com dados reais coletados na Fase 2
- [ ] Derrubando a API externa (simulada), a API devolve o último dado válido com `stale: true` após 60 min
- [ ] Local sem coleta devolve o estado vazio sem erro 500
- [ ] Contratos idênticos ao spec §10; qualquer divergência é registrada no spec
- [ ] Testes de fallback, `stale` e cálculo de 24 h passando

**Esforço:** 6–10 h · **Risco:** médio-baixo.

<details><summary>Prompt</summary>

```
Fase 3 de 6 — API do backend

Contexto
- Leia spec.md (§7, §10) e docs/01-prompt-guide.md. Fases 1 e 2 aprovadas; já há snapshots no banco.

Objetivo
Endpoints de leitura com fallback e indicador de desatualizado.

Escopo
- GET /api/locations, /api/locations/:id/summary, /hourly?hours=48, /daily, GET /api/health.
- Uma função única "snapshot mais recente com status success", reutilizada por todos.
- last_updated_at e stale em toda resposta; stale=true quando last_success_at > 60 min.
- Estado "sem dados" para local sem sucesso (sem erro 500).
- next_24h_max_precipitation_probability = maior probabilidade entre agora e agora+24h; today = dia civil inteiro.
- Horários em America/Sao_Paulo.

Fora de escopo
- /history, telas, qualquer chamada à Open-Meteo (a API lê só do banco).

Critérios de aceite
- Endpoints com dados reais e contratos do spec §10.
- Fallback e stale testados com última coleta falha.
- Local sem dados tratado.

Entrega
- Plano primeiro. Testes (fallback, stale, 24 h, vazio) com saída real.
- Arquivos alterados, divergências do spec, pendências e suposições.
```
</details>

---

## Fase 4 — Painel principal

**Objetivo:** tela completa e usável, sem recomendações meteorológicas.

**Escopo** (spec §11)
- Cabeçalho: seletor de local (até 3), "Última atualização: dd/mm às hh:mm" e aviso quando `stale`
- Cards: temperatura atual, sensação, maior chance de chuva em 24 h, precipitação de hoje, vento máximo de hoje, mín/máx de hoje
- Gráfico de temperatura por hora; gráfico de chuva (barras em mm + linha de probabilidade)
- Previsão de 7 dias com ícone, mín/máx, chuva, vento; dias de risco destacados com a regra que disparou
- Tabela única de mapeamento dos códigos WMO (ícone + descrição pt-BR)
- Estados: carregando, vazio ("Ainda sem dados"), desatualizado, erro
- Revalidação a cada 5 min sem recarregar; responsivo; unidades sempre visíveis
- **Rodapé com atribuição à Open-Meteo (CC BY 4.0)**

**Fora de escopo:** tela de comparação, login, notificações, edição de locais ou regras.

**Critérios de aceite**
- [ ] Todos os indicadores aparecem para Santos, com °C, mm e km/h
- [ ] Os dois gráficos são exibidos
- [ ] Dia com chuva ≥ 60 %, ≥ 5 mm ou vento ≥ 35 km/h aparece destacado com o motivo
- [ ] Com a coleta falhando, a tela mostra o último dado e o aviso de desatualização
- [ ] Rodapé com atribuição em todas as telas
- [ ] Nenhuma string sugere ação ao usuário (revisão manual das strings)
- [ ] A aba de rede não mostra nenhuma requisição à Open-Meteo
- [ ] Funciona em desktop e celular

**Esforço:** 11–18 h · **Risco:** médio (R3, R8).

<details><summary>Prompt</summary>

```
Fase 4 de 6 — Painel principal

Contexto
- Leia spec.md (§11) e docs/01-prompt-guide.md. Fases 1–3 aprovadas; a API responde com dados reais.

Objetivo
Painel principal completo, consumindo só a API do backend.

Escopo
- Cabeçalho com seletor de local e última atualização (aviso se stale).
- 6 indicadores do §11; gráfico de temperatura por hora; gráfico de chuva (barras mm + linha %).
- 7 dias com ícone, mín/máx, chuva, vento; dia de risco destacado com a regra e o valor.
- Mapeamento WMO em uma tabela única (ícone + descrição pt-BR).
- Estados: carregando, vazio, desatualizado, erro.
- Revalidação a cada 5 min; responsivo; unidades visíveis; pt-BR e America/Sao_Paulo.
- Rodapé com atribuição à Open-Meteo (CC BY 4.0).

Fora de escopo
- Tela de comparação, login, notificações, geocoding, edição pela interface.

Regras críticas
- O frontend nunca chama a Open-Meteo.
- Nenhum texto de recomendação; o destaque descreve só regra e valor.

Critérios de aceite
- Os listados na Fase 4 do docs/04-plano-faseado.md.

Entrega
- Plano primeiro. Depois implementação com testes de componente/lógica.
- Demonstração (screenshots ou instruções para abrir), lista de todas as strings da interface para eu revisar, arquivos alterados, pendências e suposições.
```
</details>

---

## Fase 5 — Observado e comparação

**Objetivo:** entregar a tela de comparação previsto D-1 × observado, com honestidade sobre o que é aproximado ou indisponível.

**Escopo**
- **Job do observado:** 1 vez por dia, de madrugada; busca na Historical API os dias já disponíveis e faz upsert em `observed_daily` (idempotente); falha de um local não bloqueia os outros; retry como no job da previsão
- `GET /api/locations/:id/history?days=30`: por dia, `daily_forecast` do snapshot mais próximo de 24 h antes, observado, diferença, **cobertura** (% de snapshots existentes) e status do observado (`available` / `unavailable`)
- Tela de comparação: seletor de local, período fixo de 30 dias, **tabela por dia** (máx/mín, chuva, vento: previsto, observado, diferença)
- Selo "cobertura parcial" com a porcentagem; "observado indisponível" nos dias sem dado; rótulo "reanálise" e nota explicativa; atribuição no rodapé
- Navegação entre painel e comparação

**Fora de escopo:** gráficos de comparação, resumo de erro médio, seletor de período, outras fontes.

**Critérios de aceite**
- [ ] A tela lista os últimos 30 dias com previsto D-1, observado e diferença
- [ ] Dia com snapshots faltando mostra "cobertura parcial" e a %
- [ ] Dia sem observado mostra "indisponível" e a tela não quebra
- [ ] O observado é rotulado como reanálise
- [ ] Rodar o job do observado duas vezes não duplica linhas
- [ ] O frontend não chama a Open-Meteo
- [ ] Testes do cálculo D-1, da cobertura e do upsert passando

**Esforço:** 12–18 h · **Risco:** médio (R1, R9, R10).

<details><summary>Prompt</summary>

```
Fase 5 de 6 — Observado e comparação

Contexto
- Leia spec.md (§8), docs/01-prompt-guide.md (decisões 7, 8, 11, 12, 14), docs/03-impactos.md e docs/05-validacao-api.md (host, parâmetros e defasagem reais da Historical API). Fases 1–4 aprovadas.

Objetivo
Comparar previsão D-1 com o observado (Historical API) por dia, nos últimos 30 dias, com cobertura e indisponibilidade tratadas.

Escopo
- Job diário (madrugada) que busca o observado e faz upsert em observed_daily; idempotente; falha de um local não bloqueia os outros; retry com backoff; cliente isolado.
- GET /api/locations/:id/history?days=30 com previsto D-1 (snapshot mais próximo de 24 h antes), observado, diferença, cobertura (%) e status do observado.
- Tela de comparação: seletor de local, 30 dias fixos, tabela por dia (máx/mín, chuva, vento; previsto, observado, diferença).
- "Cobertura parcial (xx%)", "observado indisponível", rótulo "reanálise" + nota explicativa.
- Navegação painel <-> comparação; rodapé de atribuição.

Fora de escopo
- Gráficos de comparação, erro médio, seletor de período, outras fontes.

Regras críticas
- Só o backend chama a Historical API; o frontend lê do banco via API.
- Não chamar o observado de "medição".

Critérios de aceite
- Os listados na Fase 5 do docs/04-plano-faseado.md.

Entrega
- Plano primeiro. Testes do cálculo D-1, cobertura, upsert e dia indisponível.
- Demonstração, arquivos alterados, pendências e suposições.
```
</details>

---

## Fase 6 — Retenção, fechamento e documentação

**Objetivo:** fechar o MVP: limpeza de dados, checklist completo do spec e documentação de execução.

**Escopo**
- Rotina diária que apaga `fetch_runs` com mais de 30 dias (e os dados ligados, em cascata); **não toca** em `observed_daily`
- Endpoint `/api/health` revisado e logs do worker legíveis no Compose
- Passada completa no checklist do spec §13 e nos critérios novos do documento de impactos (§4)
- Atualização do `spec.md` (§2, §3, §5, §8, §10, §11, §12, §13) com o que mudou
- README: como subir, como alterar limites em `risk_rules`, como adicionar locais por seed, aviso sobre backup (perder o volume apaga o histórico), restrição de uso não comercial e atribuição

**Fora de escopo:** novas funcionalidades, hospedagem, backup automático.

**Critérios de aceite**
- [ ] Dados com mais de 30 dias são removidos; `observed_daily` permanece intacto
- [ ] Todos os itens do §13 do spec e do §4 do documento de impactos marcados, com evidência
- [ ] `spec.md` reflete o sistema construído
- [ ] Alguém consegue subir o projeto do zero seguindo só o README

**Esforço:** 3–4 h · **Risco:** baixo.

<details><summary>Prompt</summary>

```
Fase 6 de 6 — Retenção, fechamento e documentação

Contexto
- Leia spec.md, docs/01-prompt-guide.md e docs/03-impactos.md. Fases 1–5 aprovadas.

Objetivo
Fechar o MVP: retenção, verificação final dos critérios e documentação.

Escopo
- Rotina diária de limpeza de fetch_runs com mais de 30 dias (cascata); observed_daily intacto.
- Revisão do /api/health e dos logs do worker.
- Verificar um a um os critérios do §13 do spec e do §4 de docs/03-impactos.md, com evidência (teste, comando ou captura).
- Atualizar spec.md com o que mudou (§2, §3, §5, §8, §10, §11, §12, §13).
- README: subir do zero, alterar risk_rules, adicionar locais por seed, aviso de backup, restrição não comercial, atribuição.

Fora de escopo
- Novas funcionalidades, hospedagem, backup automático.

Critérios de aceite
- Os listados na Fase 6 do docs/04-plano-faseado.md.

Entrega
- Plano primeiro. Tabela final: critério -> status -> evidência. Liste qualquer critério não atendido, sem omitir.
- Arquivos alterados, pendências e suposições.
```
</details>

---

## 2. Riscos por fase

| Fase | Riscos | Ponto de atenção |
|---|---|---|
| 1 | R9, R10, R11 | Se a Historical API divergir, replanejar a Fase 5 antes de avançar |
| 2 | R1, R2, R6 | Testar concorrência e payload inválido; não usar a API real nos testes |
| 3 | — | Lógica de "último sucesso" em um só lugar |
| 4 | R3, R8, R12 | Revisar todas as strings; conferir a aba de rede |
| 5 | R1, R5, R9, R10, R12 | Maior risco de escopo; manter fora os gráficos e o erro médio |
| 6 | R7, R11 | Documentar a restrição de uso não comercial e o aviso de backup |

## 3. Ordem de revisão entre fases

1. Revisar o plano que a IA apresenta **antes** de ela codar
2. Revisar o resultado contra os critérios de aceite da fase
3. Aprovar e fazer um commit
4. Só então abrir a fase seguinte

## 4. Fora do plano (ideias futuras)

Gráfico de comparação, resumo de erro médio, seletor de período, notificações, tela de cadastro de locais, hospedagem online, backup automático, multiusuário. Nada disso entra no MVP.
