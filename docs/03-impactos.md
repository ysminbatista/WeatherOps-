# WeatherOps — Análise de Impactos

> Documento 3 de 4. Base: [spec.md](../spec.md), [01-prompt-guide.md](01-prompt-guide.md), [02-discovery.md](02-discovery.md).
> Compara o **spec original** com o **escopo decidido** e mostra o que muda em cada componente.

## 1. O que mudou em relação ao spec

| # | Mudança | Origem | Tipo |
|---|---|---|---|
| M1 | Tela de comparação previsto × observado já no MVP (spec: só API) | Decisão 6 | Escopo ampliado |
| M2 | "Observado" vem da Historical Weather API, gravado no banco (spec: derivado de `current_conditions`) | Decisão 7 | Escopo ampliado / mudança de design |
| M3 | Sinalização de cobertura parcial nos dias com snapshots faltando | Decisão 8 | Escopo ampliado |
| M4 | Rodapé com atribuição à Open-Meteo (CC BY 4.0) | Decisão 10 | Requisito novo |
| M5 | Execução somente local em Docker Compose (spec: hospedagem em aberto) | Decisão 3 | Restrição |
| M6 | Worker Node separado para o job (spec: 4 opções em aberto) | Decisão 2 | Decisão técnica |
| M7 | Locais via seed: Santos + 2 de teste; sem tela de admin | Decisões 4, 9 | Confirma o spec |
| M8 | Card "Precipitação hoje" = dia civil inteiro | Decisão 5 | Confirma o spec |

## 2. Impacto por componente

Esforço em **horas, aproximado**, assumindo desenvolvimento assistido por IA e incluindo a sua revisão. É referência para dimensionar fases, não compromisso.

| Componente | O que muda | Mudanças vindas de | Esforço | Risco |
|---|---|---|---|---|
| **Infra / projeto base** | Docker Compose com Postgres, worker, API e frontend; variáveis de ambiente; scripts de migração e seed | M5, M6 | 3–5 h | Baixo |
| **Banco** | Nova tabela para o observado (ex.: `observed_daily`: local, data, máx/mín, chuva, vento, `fetched_at`). Seed de 3 locais e das 3 regras. Cascata para a retenção | M2, M7 | 3–5 h | Baixo |
| **Job de coleta (previsão)** | Conforme spec §6: retry, validação, transação, lock, cálculo de risco | — | 6–10 h | Médio |
| **Job do observado** | **Novo.** Busca na Historical API os dias já disponíveis e faz upsert em `observed_daily`. Roda diariamente (cadência a definir). Retry e tratamento de dia ainda indisponível | M2 | 4–6 h | Médio |
| **Retenção** | Limpeza diária dos snapshots com mais de 30 dias. **Pendente:** o `observed_daily` também expira em 30 dias? | — | 1–2 h | Baixo |
| **API** | Endpoints do §10 do spec. `history` muda: junta `daily_forecast` D-1 com `observed_daily` e devolve cobertura (%) e status do observado (disponível / indisponível / parcial) | M2, M3 | 7–11 h | Médio |
| **Frontend: painel** | Conforme spec §11: cards, 2 gráficos, 7 dias, destaque de risco, estados (carregando, vazio, desatualizado), revalidação de 5 min, responsivo, rodapé de atribuição | M4, M8 | 10–16 h | Médio |
| **Frontend: comparação** | **Nova tela.** Tabela por dia (previsto × observado + diferença) para máx/mín, chuva e vento; selo de cobertura parcial; "observado indisponível"; rótulo "reanálise" | M1, M2, M3 | 4–6 h | Médio |
| **Testes** | Unidade (risco, D-1, cobertura), integração do job com API simulada (timeout, 5xx, 429, payload vazio), concorrência do lock, fallback, retenção | M2 | 6–10 h | Médio |
| **Documentação** | Atualizar spec (§8, §10, §13), README de execução local | todas | 1–2 h | Baixo |
| **Total** | | | **45–73 h** | |

**Diferença em relação ao spec original:** as mudanças M1–M4 somam cerca de **+10 a +15 h** (job do observado, tela de comparação, tabela nova, atribuição e testes extras).

## 3. Impacto no spec (o que precisa ser reescrito)

| Seção do spec | Ajuste |
|---|---|
| §2 Escopo | Incluir tela de comparação e observado via Historical API |
| §3 Arquitetura | Segunda fonte de dados (outro endpoint, mesmo provedor); diagrama com o job do observado |
| §4 Fonte de dados | Documentar a chamada à Historical API (host e parâmetros a confirmar na Fase 1) |
| §5 Modelo de dados | Nova tabela `observed_daily` |
| §6 Job | Novo job do observado; manter o do forecast |
| §8 Histórico | Substituir "observado a partir de `current_conditions`". Rever se `current_conditions` ainda é necessário (ele alimenta o card de temperatura atual e continua) |
| §10 API | Contrato de `history` com cobertura e status do observado |
| §11 Frontend | Nova tela e rodapé de atribuição |
| §12 Decisões | Marcar as 6 como resolvidas |
| §13 Aceite | Acrescentar os critérios da seção 4 abaixo |

## 4. Critérios de aceite a acrescentar

- [ ] Existe tela de comparação com uma linha por dia dos últimos 30 dias, mostrando previsto D-1, observado e diferença
- [ ] Dia com snapshots faltando mostra "cobertura parcial" com a porcentagem
- [ ] Dia sem observado disponível mostra "indisponível", sem quebrar a tela
- [ ] O observado é rotulado como reanálise, não como medição de estação
- [ ] O rodapé exibe a atribuição à Open-Meteo em todas as telas
- [ ] O frontend não faz nenhuma requisição à Open-Meteo (verificável na aba de rede)
- [ ] O job do observado é idempotente: rodar duas vezes não duplica linhas

## 5. Impacto técnico e de dados

| Tema | Análise |
|---|---|
| Volume | ~726 mil linhas horárias em 30 dias (spec §8). `observed_daily` adiciona ~90 linhas por mês (3 locais × 30 dias), desprezível |
| Chamadas externas | Forecast: 144/dia. Observado: poucas por dia (até 3). Total ≈ 1,5 % do limite diário da Open-Meteo |
| Performance | O índice `(location_id, fetch_run_id, forecast_time)` cobre as leituras do painel. A consulta D-1 precisa achar "o snapshot mais próximo de 24 h antes" por dia; pode exigir índice em `fetch_runs(location_id, started_at)`. Validar com `EXPLAIN` na fase da API |
| Consistência | Gravação em transação garante que previsão e risco do mesmo snapshot nunca ficam pela metade. O observado é independente e entra por upsert |
| Retenção | Cascata a partir de `fetch_runs`. O observado não depende de `fetch_runs`, por isso a limpeza dele é regra separada |
| Dependência externa | Duas chamadas a endpoints diferentes: falha de um não deve derrubar o outro |
| Migrações | Primeira migração inclui todas as tabelas do spec mais `observed_daily`; sem dados legados a migrar |

## 6. Impacto no usuário e na operação

| Tema | Impacto | Tratamento |
|---|---|---|
| Máquina desligada | Para a coleta. Ao religar, só há dados a partir daquele momento; o último dado válido aparece com aviso de desatualizado | Fallback do spec §7; cobertura parcial na comparação |
| Execução local | Sem monitoramento externo. Falhas só são vistas se você olhar | `GET /api/health` e o aviso de desatualização na tela são a única observabilidade; logs do worker no Compose |
| Primeiro uso | Painel vazio até a primeira coleta terminar ("Ainda sem dados") | Rodar uma coleta imediata ao subir o worker, sem esperar o próximo ciclo de 30 min |
| Comparação nos primeiros dias | Sem histórico, a tela fica vazia ou quase | Mensagem explicando que o histórico cresce com o tempo |
| Leitura de risco | Destaque pode ser lido como conselho | Texto só descritivo, revisado contra a regra 2 do guia |
| Dias recentes na comparação | Observado indisponível por defasagem da Historical API | Estado "indisponível" explícito |
| Manutenção | Mudar limites de risco é por SQL na tabela; sem interface | Aceito pelo spec. Documentar o comando no README |
| Backup | Sem rotina; perder o volume do Docker perde o histórico | Aceitável para uso didático. Registrar no README |

## 7. Riscos consolidados

Une os riscos do Discovery (R1–R8, com R9 e R10 novos) e os impactos acima.

| # | Risco | Prob. | Impacto | Mitigação | Fase sugerida |
|---|---|---|---|---|---|
| R1 | Máquina desligada gera buracos no histórico | Alta | Médio | Cobertura parcial; coleta imediata ao subir | Job + API |
| R2 | Open-Meteo indisponível ou em limite | Baixa | Médio | Retry + fallback; testes com API simulada | Job |
| R3 | Destaque lido como recomendação | Média | Médio | Textos descritivos; revisão de strings | Frontend |
| R4 | Escopo cresce com a tela de comparação | Alta | Médio | Fase própria depois do painel | Plano |
| R5 | "Observado" tomado como dado de estação | Baixa | Baixo | Rótulo "reanálise" | Frontend |
| R6 | Duas execuções simultâneas do job | Baixa | Alto | `pg_advisory_lock` + teste de concorrência | Job |
| R7 | Mudança para uso comercial sem licença | Baixa | Alto | Registrar restrição no README | Docs |
| R8 | Falta de atribuição CC BY 4.0 | Média | Baixo | Rodapé desde o primeiro painel | Frontend |
| R9 | Defasagem da Historical API maior que o esperado | Média | Médio | Validar com chamada real na Fase 1; estado "indisponível" | Fase 1 |
| R10 | Mudança nos parâmetros ou no endpoint da Historical API | Baixa | Médio | Camada única de acesso à API; testes de contrato com payload de exemplo | Job do observado |
| R11 | Perda do volume do Docker apaga o histórico | Média | Baixo | Volume nomeado; registrar no README | Infra |
| R12 | IA expande escopo em fase inteira por prompt | Média | Médio | Fora de escopo explícito no prompt; revisão ao fim da fase | Todas |

## 8. Decisões tomadas

| # | Pergunta | Decisão |
|---|---|---|
| P1 | O `observed_daily` expira em 30 dias? | **Não expira.** A limpeza diária só atinge snapshots |
| P2 | Cadência do job do observado | **1 vez por dia, de madrugada**, buscando os últimos dias disponíveis |
| P3 | Coleta imediata ao subir o worker? | **Sim** |
| P4 | Seletor na comparação | **Seletor de local; período fixo de 30 dias** |

## 9. Conclusão

O escopo cresceu de forma moderada (+10 a +15 h sobre um total de 45 a 73 h), concentrado em dois itens novos: o **job do observado** e a **tela de comparação**. Nenhuma mudança conflita com as regras fixas do guia. O maior risco técnico (R9) se resolve cedo, com uma chamada real à Historical API na primeira fase.
