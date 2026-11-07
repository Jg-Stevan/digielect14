#!/usr/bin/env bash
# KIT e14-ola1 (bloque 1.3, cierra F11 en el hermano) — REESCRITURA de historia
# de supervision-e14 para eliminar `src/modules/supervision/data/actas-reales/`
# (nombres de archivo con códigos DANE de mesa) y la copia del digitalizador.
# Mismos prerrequisitos y advertencias que el script del hermano.
set -euo pipefail

REPO_URL="https://github.com/Jg-Stevan/supervision-e14.git"
DIR="${1:-supervision-e14-rewrite}"

command -v git-filter-repo >/dev/null || { echo "FALTA: pip install git-filter-repo"; exit 1; }

git clone "$REPO_URL" "$DIR"
cd "$DIR"

git filter-repo --invert-paths \
  --path src/modules/supervision/data/actas-reales \
  --path src/modules/digitalizador/assets/acta-e14-real.jpg \
  --force

git remote add origin "$REPO_URL"
echo "▶ Verificación ANTES del push (objetivo: 0):"
git rev-list --all --objects | grep -cE "actas-reales|acta-e14-real" || echo "0 (limpio)"
echo "▶ gitleaks sobre la historia completa (objetivo: 0 hallazgos):"
gitleaks git --log-opts="--all" || true

echo ""
echo "REVISIÓN LISTA en $DIR. Para aplicarla:"
echo "  cd $DIR && git push origin --force --all && git push origin --force --tags"
