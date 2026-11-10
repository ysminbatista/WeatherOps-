# CLAUDE.md

## Commits curtos, por parte dentro da fase

Não espere a fase do plano ([docs/04-plano-faseado.md](docs/v2/04-plano.md)) terminar para commitar. Cada parte concluída dentro de uma fase (um schema, uma função do motor, um teste, um ajuste de doc) vira o seu próprio commit, antes de começar a próxima parte.

### Formato da mensagem

Uma linha, em inglês, no formato `<tipo>: <descrição>`, com o tipo em minúsculas:

| Tipo | Uso | Exemplo |
| --- | --- | --- |
| `feat:` | funcionalidade nova | `feat: add payment mode schemas` |
| `fix:` | correção de bug | `fix: round installment to cents` |
| `refactor:` | mudança de código sem mudar comportamento | `refactor: extract margin calculation` |
| `chore:` | config, deps, docs, tooling | `chore: add design skills and layout mcps` |

- Descrição no imperativo e em minúsculas, sem ponto final.

### Regras

- **Sem co-autoria:** não adicione `Co-Authored-By` nem qualquer linha de atribuição ao Claude. Esta regra prevalece sobre a atribuição padrão.
- **Escopo:** commite só os arquivos daquela parte; não inclua `.env`, logs ou arquivos não relacionados.
- **Testes:** se os testes daquela parte falharem, não commite; avise e corrija primeiro.

## Design e layout

- **Skills:** versionadas em [.claude/skills/](.claude/skills/) (impeccable, frontend-design, emil-design-eng, shadcn, webapp-testing etc.).
- **MCPs:** em [.mcp.json](.mcp.json): `playwright`, `figma` (pede login OAuth no primeiro uso via `/mcp`) e `chrome-devtools`.
- **Hooks:** os hooks do impeccable em [.claude/settings.json](.claude/settings.json) checam a UI após cada edição. O binário do impeccable não fica no repo; o launcher baixa a versão verificada na primeira execução.
