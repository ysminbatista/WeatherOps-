#!/usr/bin/env bash
# Instala as skills de terceiros listadas em skills/skills.json (escopo "global").
#
#   ./scripts/instalar-skills.sh            -> só as favoritas
#   ./scripts/instalar-skills.sh --todas    -> todas as globais do catálogo
#   ./scripts/instalar-skills.sh --dry-run  -> mostra os comandos sem rodar
#
# Agente: por padrão o CLI instala nos agentes detectados. Para forçar:
#   AGENTE=claude-code ./scripts/instalar-skills.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
TODAS=0; DRY=0
for a in "$@"; do
  case "$a" in
    --todas) TODAS=1 ;;
    --dry-run) DRY=1 ;;
    *) echo "Opção desconhecida: $a"; exit 1 ;;
  esac
done

LISTA="$(python3 - "$RAIZ/skills/skills.json" "$TODAS" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); todas = sys.argv[2] == "1"
for s in d["skills"]:
    if s["escopo"] == "global" and (todas or s.get("favorita")):
        print(s["fonte"], s["nome"])
PY
)"

AG=()
[ -n "${AGENTE:-}" ] && AG=(-a "$AGENTE")

while read -r fonte nome; do
  [ -z "$fonte" ] && continue
  echo "→ $nome  ($fonte)"
  if [ "$DRY" = 1 ]; then
    echo "  npx -y skills add $fonte -s $nome -g -y ${AG[*]:-}"
  else
    npx -y skills add "$fonte" -s "$nome" -g -y ${AG[@]+"${AG[@]}"} || echo "  !! falhou: $nome"
  fi
done <<< "$LISTA"

echo "Pronto. Confira com: npx skills ls -g"
