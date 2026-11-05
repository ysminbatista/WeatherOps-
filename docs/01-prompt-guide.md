# WeatherOps — Prompt Guide

> Regras e boas práticas para desenvolver o WeatherOps com IA (Claude Code).
> Fonte de verdade do produto: [spec.md](../spec.md). Este guia define **como** pedir; o spec define **o quê**.

## 1. Decisões fechadas

Resolvem o §12 do spec. A IA não deve reabrir estes pontos nem escolher alternativas por conta própria.

| # | Decisão | Escolha |
|---|---|---|
| 1 | Backend | Node.js (mesma linguagem do Next.js) |
| 2 | Job de coleta | Worker Node separado, rodando no Docker Compose, agendado a cada 30 min, com `pg_advisory_lock` |
| 3 | Hospedagem | Só local (Docker Compose). Hospedagem fica para depois do MVP |
| 4 | Cadastro de locais | Seed / arquivo de configuração. Sem tela de admin |
| 5 | Card "Precipitação prevista hoje" | Dia civil inteiro (usa `precipitation_sum` do dia) |
| 6 | Histórico | **Já com tela de comparação** previsão D-1 × observado no MVP |

| 7 | Fonte do "observado" | Historical Weather API da Open-Meteo, gravada no banco (substitui o cálculo a partir de `current_conditions` do spec §8) |
| 8 | Tela de comparação | Tabela por dia (previsto D-1 × observado), com cobertura parcial sinalizada |
| 9 | Seed de locais | Santos + 2 de teste (ex.: São Paulo, Rio de Janeiro) |
| 10 | Atribuição | Rodapé com crédito à Open-Meteo (CC BY 4.0) |

| 11 | Retenção do observado | `observed_daily` não expira; a limpeza de 30 dias atinge só snapshots |
| 12 | Job do observado | 1 vez por dia, de madrugada, com upsert idempotente |
| 13 | Coleta inicial | Worker faz uma coleta imediata ao subir, sem esperar o ciclo de 30 min |
| 14 | Comparação | Seletor de local; período fixo de 30 dias |

> As decisões 6, 7 e 8 ampliam o escopo do spec original. Os documentos de impacto e de plano faseado devem refletir isso.

## 2. Regras que valem em todo prompt

Estas são as invariantes do spec. Repita-as ou aponte para este guia em todo prompt de fase.

1. **O frontend nunca chama a Open-Meteo.** Toda leitura passa pelo backend e vem do banco (spec §3).
2. **O sistema não faz recomendação meteorológica.** Nada de "leve guarda-chuva". A interface descreve regra e valor, e só (spec §9).
3. **Limites de risco ficam em `risk_rules`**, nunca fixos no código. Mudar um limite deve valer na coleta seguinte, sem deploy (spec §9, §13).
4. **Snapshots nunca são sobrescritos.** Cada coleta grava linhas novas ligadas a um `fetch_run` (spec §5).
5. **Gravação em uma única transação:** `current_conditions`, `hourly_forecast` e `daily_forecast` entram juntos ou não entram (spec §6).
6. **Falha em um local não bloqueia os outros** na coleta (spec §6).
7. **Fallback sempre ativo:** a API devolve o último snapshot com `status = success` e marca `stale: true` quando passar de 60 min (spec §7).
8. **Unidades explícitas** na chamada à API e na interface: °C, mm, km/h (spec §4, §11).
9. **Fuso e idioma:** `America/Sao_Paulo`, formato pt-BR.
10. **Máximo de 3 locais ativos**, validado na aplicação (spec §5).

## 3. Como estruturar um prompt de fase

Como cada prompt cobre uma fase inteira, ele precisa ser completo. Use esta estrutura:

```
Fase: <nome e número no plano faseado>

Contexto
- Leia spec.md e docs/01-prompt-guide.md antes de começar.
- Estado atual: <o que já existe e funciona>

Objetivo
<resultado da fase em 2–3 frases>

Escopo
- <lista fechada do que entra>

Fora de escopo
- <o que NÃO deve ser feito nesta fase>

Critérios de aceite
- <itens verificáveis, tirados do §13 do spec>

Entrega
- Rodar os testes e mostrar o resultado.
- Listar arquivos criados/alterados.
- Listar o que ficou pendente ou foi assumido.
```

### Boas práticas

- **Aponte para o spec por seção** ("conforme §6 do spec"), em vez de reescrever o conteúdo. Evita divergência entre prompt e spec.
- **Declare o fora de escopo.** É o que mais protege contra a IA adicionar login, notificações, geocoding ou outras fontes.
- **Dê critérios de aceite verificáveis**, não adjetivos. "Quarta coleta aparece 30 min depois (± 1 min)" em vez de "o job funciona bem".
- **Um objetivo por fase.** Se o prompt precisa de "e também", provavelmente são duas fases.
- **Peça suposições explícitas.** Se a IA preencher uma lacuna do spec, ela deve avisar, não decidir em silêncio.
- **Não cole código no prompt** a menos que seja um trecho exato a preservar. Aponte o arquivo.

## 4. Autonomia: fase inteira por prompt

Trabalhar com uma fase por prompt dá velocidade, mas aumenta o custo de um erro. Para compensar:

- **Faça a IA planejar antes de codar.** Peça o plano da fase (arquivos, ordem, riscos) e aprove antes da implementação.
- **Exija testes junto com o código**, sobretudo nas partes que não dá para conferir olhando a tela: lógica de risco, retry, fallback, retenção e cálculo D-1 × observado.
- **Revise ao fim de cada fase**, antes de iniciar a seguinte. Uma fase com defeito contamina as próximas.
- **Pare em decisões novas.** Se aparecer algo fora das decisões fechadas (seção 1), a IA pergunta e não escolhe.
- **Trabalhe com versionamento.** O projeto ainda não é um repositório git; inicializar um antes da primeira fase permite desfazer uma fase inteira com segurança.

## 5. Boas práticas por área

### Banco e migrations
- Toda mudança de schema vai em migration versionada, nunca em alteração manual.
- Respeite tipos e índices do §5 do spec, incluindo `(location_id, fetch_run_id, forecast_time)`.
- Cascata de `fetch_runs` para as tabelas filhas, porque a limpeza de 30 dias depende dela.

### Job de coleta
- Siga a ordem do §6: criar run, chamar API (timeout 10 s), retry até 2 vezes (2 s e 5 s), validar payload, gravar em transação, calcular risco, fechar o run.
- Validação do payload é obrigatória: blocos `current`, `hourly` e `daily` presentes e não vazios.
- Teste o job contra uma API simulada (timeout, 5xx, 429, payload vazio), não contra a real.
- Execuções simultâneas não podem corromper dados (lock).

### API
- Toda resposta traz `last_updated_at` e `stale`.
- A lógica de "snapshot mais recente com sucesso" fica em um único lugar e todos os endpoints a reutilizam.
- Contratos de resposta seguem o §10; mudança de contrato exige atualizar o spec.

### Frontend
- Sem texto que sugira ação ao usuário. Revisar toda string de interface contra a regra 2.
- Estados obrigatórios: carregando, vazio ("Ainda sem dados"), desatualizado (aviso com data/hora) e erro.
- Mapeamento de `weather_code` WMO em uma tabela única (ícone + descrição).
- Revalidação a cada 5 min sem recarregar a página.
- Responsivo: conferir desktop e celular.

### Histórico e comparação
- Compara o `daily_forecast` do snapshot mais próximo de 24 h antes (D-1) com o observado vindo da Historical Weather API, **gravado no banco** (o backend busca; o frontend nunca chama a API).
- "Observado" é reanálise, não medição de estação. O rótulo da tela deve dizer isso.
- Dias recentes podem não ter observado disponível (defasagem da API): mostrar "indisponível". Dias com snapshots faltando mostram "cobertura parcial".

## 6. O que a IA deve sempre fazer

- Ler o spec e este guia antes de começar.
- Dizer o que foi feito, o que não foi e o que foi assumido.
- Rodar testes e informar o resultado real, inclusive falhas.
- Perguntar quando faltar informação, em vez de inventar.

## 7. O que a IA nunca deve fazer

- Chamar a Open-Meteo a partir do frontend.
- Fixar limites de risco no código.
- Escrever texto de recomendação meteorológica.
- Sobrescrever ou apagar snapshots fora da rotina de retenção.
- Adicionar itens do "Fora do MVP" (login, notificações, geocoding, edição de locais pela interface, outras fontes).
- Alterar o spec ou as decisões fechadas sem pedir confirmação.

## 8. Checklist antes de aceitar uma fase

- [ ] Critérios de aceite da fase atendidos e demonstrados
- [ ] Testes passando, com saída mostrada
- [ ] Nenhuma regra da seção 2 violada
- [ ] Nada do fora de escopo foi implementado
- [ ] Suposições da IA revisadas e aprovadas
- [ ] Documentação atualizada, se algo mudou
