#!/usr/bin/env bash
# KIT e14-ola1 (bloque 1.3, cierra F11) — REESCRITURA de historia de digielect14
# para eliminar `src/assets/acta-e14-real.jpg` de TODOS los commits.
#
# ⚠️  LO EJECUTA EL DUEÑO, no un agente: fuerza push y reescribe SHAs.
# Prerrequisitos:
#   pip install git-filter-repo     (exige repo limpio y sin remotes viejos)
#   AVISAR a cualquier clon vivo antes (la reescritura invalida clones y
#   cachés de CI — la auditoría no detecta colaboradores, pero tú lo sabes).
#
# Tras ejecutar: `bun install`, verificar `scripts/assets.lock.json` (los
# hashes siguen válidos — el filter-repo no toca working tree, solo historia),
# forzar rebuild de CI (cachés de Actions pueden referenciar SHAs viejos).
set -euo pipefail

REPO_URL="https://github.com/Jg-Stevan/digielect14.git"
RUTA_FOTO="src/assets/acta-e14-real.jpg"
DIR="${1:-digielect14-rewrite}"

command -v git-filter-repo >/dev/null || { echo "FALTA: pip install git-filter-repo"; exit 1; }

git clone "$REPO_URL" "$DIR"
cd "$DIR"

git filter-repo --invert-paths --path "$RUTA_FOTO" --force

# Re-añadir el remote (filter-repo lo suelta a propósito) y forzar el push:
git remote add origin "$REPO_URL"
echo "▶ Verificación ANTES del push (objetivo: 0):"
git rev-list --all --objects | grep -c "acta-e14-real" || echo "0 (limpio)"
echo "▶ gitleaks sobre la historia completa (objetivo: 0 hallazgos):"
gitleaks git --log-opts="--all" || true

echo ""
echo "REVISIÓN LISTA en $DIR. Para aplicarla:"
echo "  cd $DIR && git push origin --force --all && git push origin --force --tags"
echo "Después: contactar GitHub Support para purgar vistas cacheadas del blob"
echo "(SHA directo) si la sensibilidad lo justifica, y re-corre CI."
