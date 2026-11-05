#!/usr/bin/env bash
# Prepara um projeto com os MCPs, skills de projeto e hooks deste repositório.
#
#   ./scripts/novo-projeto.sh <pasta-do-projeto> [opções]
#
# Opções:
#   --mcp algoritmi|completo   copia mcps/<perfil>.mcp.json para <projeto>/.mcp.json (padrão: algoritmi)
#   --sem-mcp                  não mexe no .mcp.json
#   --neon                     instala as skills do Neon no projeto
#   --skill <nome>             copia uma skill própria de skills/proprias/ (pode repetir)
#   --hooks                    grava os hooks do impeccable em .claude/settings.local.json
#
# Nunca sobrescreve arquivo existente: se já houver, avisa e pula.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
[ $# -lt 1 ] && { sed -n '2,13p' "$0"; exit 1; }
DEST="$(cd "$1" && pwd)"; shift

PERFIL=algoritmi; NEON=0; HOOKS=0; SKILLS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --mcp) PERFIL="$2"; shift ;;
    --sem-mcp) PERFIL="" ;;
    --neon) NEON=1 ;;
    --skill) SKILLS+=("$2"); shift ;;
    --hooks) HOOKS=1 ;;
    *) echo "Opção desconhecida: $1"; exit 1 ;;
  esac
  shift
done

if [ -n "$PERFIL" ]; then
  ORIG="$RAIZ/mcps/$PERFIL.mcp.json"
  [ -f "$ORIG" ] || { echo "Perfil de MCP inexistente: $PERFIL"; exit 1; }
  if [ -e "$DEST/.mcp.json" ]; then
    echo "• .mcp.json já existe, pulei (compare com mcps/$PERFIL.mcp.json)"
  else
    cp "$ORIG" "$DEST/.mcp.json"; echo "✓ .mcp.json ($PERFIL)"
    grep -q '\${' "$DEST/.mcp.json" && echo "  ! defina as variáveis \${...} no ambiente antes de abrir o Claude"
  fi
fi

if [ "$NEON" = 1 ]; then
  (cd "$DEST" && npx -y skills add neondatabase/agent-skills -s '*' -y) && echo "✓ skills do Neon"
fi

for s in ${SKILLS[@]+"${SKILLS[@]}"}; do
  ORIG="$RAIZ/skills/proprias/$s"
  [ -d "$ORIG" ] || { echo "Skill própria inexistente: $s"; continue; }
  mkdir -p "$DEST/.claude/skills"
  if [ -e "$DEST/.claude/skills/$s" ]; then
    echo "• skill $s já existe no projeto, pulei"
  else
    cp -R "$ORIG" "$DEST/.claude/skills/$s"; echo "✓ skill $s"
  fi
done

if [ "$HOOKS" = 1 ]; then
  mkdir -p "$DEST/.claude"
  if [ -e "$DEST/.claude/settings.local.json" ]; then
    echo "• .claude/settings.local.json já existe: junte à mão o conteúdo de hooks/impeccable.settings.json"
  else
    cp "$RAIZ/hooks/impeccable.settings.json" "$DEST/.claude/settings.local.json"; echo "✓ hooks do impeccable"
  fi
fi
