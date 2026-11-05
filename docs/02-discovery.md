# WeatherOps — Discovery

> Documento 2 de 4. Base: [spec.md](../spec.md) e [01-prompt-guide.md](01-prompt-guide.md).
> Contexto: uso **pessoal/didático**. Não há cliente externo; "cliente" no spec = o próprio dono do projeto.

## 1. Problema

Ver, em um só lugar, as condições e a previsão do tempo de até 3 locais (Santos como padrão) e identificar rapidamente os dias que passam de limites de risco que **o próprio usuário define**. Hoje isso exige abrir apps de clima genéricos, que não destacam risco por regra própria e não guardam histórico para comparar previsão com o que ocorreu.

O produto **mostra dados e aplica regras**; não aconselha (sem "leve guarda-chuva").

## 2. Usuário e casos de uso

**Usuário único:** o dono do projeto, sem login e sem multiusuário.

| # | Caso de uso | Resultado esperado |
|---|---|---|
| U1 | Abrir o painel e ver o tempo agora | Temperatura, sensação, chance de chuva 24 h, precipitação, vento e mín/máx de hoje |
| U2 | Ver os próximos 7 dias | Cards por dia com mín/máx, chuva e vento |
| U3 | Saber quais dias são de risco e por quê | Dia destacado + regra disparada ("Chuva ≥ 60% · Vento ≥ 35 km/h") |
| U4 | Ajustar um limite de risco | Altera `risk_rules`; vale na coleta seguinte, sem deploy |
| U5 | Confiar no que vê quando a fonte cai | Último dado válido + aviso com data/hora |
| U6 | Comparar previsão D-1 com o observado | Tela de comparação por dia (últimos 30 dias) |
| U7 | Acompanhar até 3 locais | Seletor de local no cabeçalho |

**Valor didático:** o projeto exercita job agendado, resiliência (retry, lock, fallback), modelagem de snapshots, retenção de dados e frontend com revalidação.

## 3. Escopo confirmado

Dentro: tudo do §2 do spec **mais** a tela de comparação (decisão 6 do guia, ampliando o spec).
Fora: login, notificações, geocoding, edição de locais/regras pela interface, outras fontes. Locais entram por seed; regras por tabela.

## 4. Validação técnica da Open-Meteo

Verificado nas páginas oficiais em 05/11/2026. Confirmar de novo antes de publicar qualquer coisa.

| Tema | Achado | Impacto |
|---|---|---|
| Custo e uso | API gratuita **apenas para uso não comercial**, sem garantia de disponibilidade ([Pricing](https://open-meteo.com/en/pricing), [Terms](https://open-meteo.com/en/terms)) | Uso pessoal/didático se enquadra. Uso comercial exigiria assinatura |
| Limites | Menos de 10.000 chamadas/dia, 5.000/hora, 600/minuto. A página de preços cita também 300.000/mês, divergência não explicada | Nosso consumo: 3 locais × 48 coletas = **144 chamadas/dia** (~4.320/mês), muito abaixo de qualquer limite |
| Limite por IP | Limites aplicados por IP/aplicação; hosts compartilhados (Vercel, Netlify) podem estourar antes | Rodar local com IP próprio elimina o risco. Relevante se hospedar depois |
| Atribuição | Dados sob licença **CC BY 4.0**: atribuição é obrigatória | A interface precisa exibir crédito à Open-Meteo. **Não está no spec** |
| Probabilidade de chuva | `precipitation_probability` vem de modelos de ensemble (~0,25°, ~27 km) e indica chance de mais de 0,1 mm na hora anterior ([Docs](https://open-meteo.com/en/docs)) | É resolução grosseira para um ponto como Santos. A regra "≥ 60%" deve ser lida como indicador, não como medição |
| Campos usados | `precipitation_probability` existe nas variáveis horárias e diárias (máx/média/mín) | `precipitation_probability_max` do spec é válido |
| `forecast_days` | Não confirmado nas páginas consultadas (a busca não trouxe a descrição do parâmetro) | Validar com uma chamada real na Fase 1 |
| Auto-hospedagem | Servidor é open source e pode ser hospedado por conta própria | Alternativa futura se os limites virarem problema. Hoje desnecessária |

## 5. Pontos de atenção do modelo de dados

- **"Observado" não é medição.** O spec calcula máx/mín observadas a partir de `current_conditions` amostrado a cada 30 min, e `current` da Open-Meteo é valor de modelo, não de estação. A tela de comparação compara, na prática, **duas saídas de modelo**. Isso precisa estar explícito na interface.
- **Cobertura da amostragem.** Se o job ficar parado (máquina local desligada), o "observado" do dia fica incompleto e a comparação distorce.
- **Fuso e dia civil.** "Hoje", D-1 e agrupamento por data usam `America/Sao_Paulo`. Mudança de horário de verão não existe hoje no Brasil, mas gravar `timestamptz` e converter na leitura evita erro.
- **Volume:** ~726 mil linhas horárias em 30 dias, tranquilo para PostgreSQL.

## 6. Riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | Máquina local desligada interrompe a coleta; histórico com buracos | Alta | Médio | Marcar dias com cobertura incompleta; exibir cobertura na comparação |
| R2 | Open-Meteo indisponível ou em limite | Baixa | Médio | Retry + fallback já no spec; testar com API simulada |
| R3 | Usuário interpreta o destaque como recomendação | Média | Médio | Textos só descritivos; revisão de strings (regra 2 do guia) |
| R4 | Tela de comparação aumenta escopo e prazo | Alta | Médio | Entregar em fase própria depois do painel principal |
| R5 | "Observado" ser entendido como dado real de estação | Média | Médio | Rótulo e nota explicativa na tela |
| R6 | Duas execuções simultâneas do job | Baixa | Alto | `pg_advisory_lock` + teste de concorrência |
| R7 | Mudar de uso pessoal para comercial | Baixa | Alto | Registrar a restrição de licença; reavaliar antes de qualquer uso comercial |
| R8 | Falta de atribuição CC BY 4.0 | Média | Baixo | Rodapé com crédito desde a primeira versão do painel |

## 7. Premissas

1. Uso não comercial durante todo o MVP.
2. Rodar localmente em Docker Compose; a máquina fica ligada na maior parte do tempo, mas sem garantia.
3. Open-Meteo continua gratuita com os limites atuais.
4. Santos é o único local de uso real; os outros dois são para exercitar o limite de 3.
5. Mapeamento de `weather_code` segue os códigos WMO documentados pela Open-Meteo.
6. Sem requisito formal de desempenho, acessibilidade ou idiomas além de pt-BR.

## 8. Perguntas abertas

Como não há cliente externo, são perguntas para você.

| # | Pergunta | Por que importa |
|---|---|---|
| Q1 | Quais locais além de Santos você quer no seed? | Define os dados de teste e a seleção no cabeçalho |
| Q2 | Se a máquina ficar desligada por horas, o histórico com buracos é aceitável? | Define se a comparação precisa tratar cobertura incompleta (R1) |
| Q3 | Aceita que "observado" seja valor de modelo da própria Open-Meteo? Ou quer usar a Historical Weather API (mesmo provedor, dado reanalisado) para o observado? | Muda a qualidade da comparação; o spec proíbe "outras fontes", mas este seria outro endpoint do mesmo provedor |
| Q4 | A atribuição à Open-Meteo no rodapé está ok? | Exigência de licença, ausente do spec |
| Q5 | Os limites iniciais (60 %, 5 mm, 35 km/h) fazem sentido para Santos? | Calibra o que conta como risco |
| Q6 | Para a tela de comparação: quais métricas e que tipo de visualização? | Define o escopo da fase de histórico |
| Q7 | Existe prazo ou data-alvo? | Define o tamanho das fases |
| Q8 | Pretende hospedar online depois? | Se sim, o limite por IP em hosts compartilhados passa a importar |

## 8.1 Respostas e decisões

| # | Decisão |
|---|---|
| Q1 | Seed: Santos + 2 locais de teste (ex.: São Paulo, Rio de Janeiro) |
| Q3 | "Observado" vem da **Historical Weather API** da Open-Meteo (mesmo provedor, outro endpoint), não de `current_conditions`. Amplia o spec |
| Q2 | Dia com coleta incompleta fica marcado como **cobertura parcial**, com % de coletas existentes |
| Q6 | Tela de comparação = **tabela por dia** (previsto × observado, com diferença) para temperatura máx/mín, chuva e vento |
| Q7 | Sem prazo fixo |
| Q4, Q5, Q8 | Sem resposta; assumidos: atribuição no rodapé, limites iniciais do spec, hospedagem só local |

**Consequências da decisão Q3:**
- O backend (nunca o frontend) passa a chamar um segundo endpoint. A regra "frontend nunca chama a Open-Meteo" continua valendo.
- Os dados observados devem ser **gravados no banco** (nova tabela, ex.: `observed_daily`) para manter o fallback e a leitura só pelo banco.
- A Historical API tem **defasagem**: dias muito recentes podem não estar disponíveis ou ser provisórios. A tela deve mostrar "observado indisponível" nesses dias. **A defasagem exata não foi verificada e precisa ser confirmada na Fase 1** ([Historical API](https://open-meteo.com/en/docs/historical-weather-api)).
- O dado vem de reanálise, que continua sendo modelo, mas é mais consistente que amostrar `current`. O rótulo "observado" deve dizer "reanálise".
- A cobertura parcial passa a afetar o lado do **previsto D-1** (snapshots faltando), não o do observado.
- O risco R5 cai de nível; surgem dois novos: defasagem da Historical API (R9) e dependência de um segundo endpoint (R10).

## 9. Conclusões

- O MVP é **viável e barato**: o consumo da API é cerca de 1,5 % do limite diário.
- Três lacunas do spec para tratar: **atribuição CC BY 4.0**, **natureza do "observado"** e **dias com cobertura incompleta**.
- A tela de comparação é o item de maior risco de escopo e deve ficar em fase própria.

Fontes: [Open-Meteo Pricing](https://open-meteo.com/en/pricing) · [Terms](https://open-meteo.com/en/terms) · [Docs](https://open-meteo.com/en/docs)
