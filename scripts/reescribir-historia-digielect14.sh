#!/usr/bin/env bash
# KIT e14-ola1 (bloque 1.3, cierra F11) — REESCRITURA de historia de digielect14
# para eliminar `src/assets/acta-e14-real.jpg` de TODOS los commits.
#
# ⚠️  LO EJECUTA EL MANTENEDOR, no un agente: fuerza push y reescribe SHAs.
# Endurecido en la remediación de la auditoría 2026-11-11: bundle de respaldo
# obligatorio, --force-with-lease (nunca --force a secas) y registro del SHA
# previo de main.
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

# Re-verifica las rutas alcanzables antes de filtrar. Si aparece una ruta
# nueva, añádela al --path de abajo.
echo "▶ Rutas alcanzables con 'acta-e14-real' (objetivo: solo $RUTA_FOTO):"
git rev-list --all --objects | grep -i "acta-e14-real" || echo "0 (limpio)"

SHA_PREVIO="$(git rev-parse origin/main 2>/dev/null || git rev-parse main)"
echo "▶ SHA previo de main: $SHA_PREVIO"
echo "  Anótalo en docs/DECISIONS.md al cerrar la purga (plantilla Anexo C)."

BUNDLE="../digielect14-backup-$(date +%Y%m%d).bundle"
git bundle create "$BUNDLE" --all
echo "▶ Respaldo creado: $BUNDLE (guárdalo fuera de la máquina de trabajo)"

git filter-repo --invert-paths --path "$RUTA_FOTO" --force

# Re-añadir el remote (filter-repo lo suelta a propósito) y refrescar los
# refs: --force-with-lease necesita conocer el estado real del remoto.
git remote add origin "$REPO_URL"
git fetch origin

echo "▶ Verificación ANTES del push (objetivo: 0):"
git rev-list --all --objects | grep -ic "acta-e14-real" || echo "0 (limpio)"
echo "▶ gitleaks sobre la historia completa (objetivo: 0 hallazgos):"
gitleaks git --log-opts="--all" || true

echo ""
echo "REVISIÓN LISTA en $DIR. SHA previo de main: $SHA_PREVIO"
echo "Para aplicarla (nunca --force a secas — regla del AGENTS.md):"
echo "  cd $DIR && git push origin --force-with-lease --all && git push origin --force-with-lease --tags"
echo "Después: contactar GitHub Support para purgar vistas cacheadas del blob"
echo "(SHA directo) si la sensibilidad lo justifica, y re-corre CI."
