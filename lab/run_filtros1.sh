#!/usr/bin/env bash
# run_filtros1.sh — orquestador del kit FILTROS-1 (pasos 2-8 del kit).
#
# Modo oficial (requiere las 4 fotos del dueño en lab/fotos/):
#   bash run_filtros1.sh
# Modo humo (1 foto cualquiera, valida el rig end-to-end):
#   bash run_filtros1.sh --humo <ruta/foto.jpg>
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out fotos resultados

PY="cache/venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "[FILTROS-1] no hay venv — corre setup_env.sh primero"
  exit 2
fi

if [ "${1:-}" = "--humo" ]; then
  FOTO="$2"
  STEM="$(basename "$FOTO")"
  echo "[FILTROS-1] HUMO con $STEM"
  "$PY" variantes.py "$FOTO" out
  "$PY" bench.py out --humo "$FOTO"
  "$PY" reporte.py out
  "$PY" laminas.py out
  "$PY" zip_pack.py out "resultados/humo-filtros-e14"
else
  N=$(ls fotos/*.jpg fotos/*.jpeg fotos/*.png 2>/dev/null | wc -l || true)
  if [ "$N" -lt 4 ]; then
    echo "[FILTROS-1] BLOQUEADO: hay $N foto(s) en lab/fotos/ y el kit exige 4:"
    echo "  · Frankfurt-P2 foto campo (1).jpg   → GT F (Apéndice B)"
    echo "  · Frankfurt-P2 foto campo (2).jpg   → GT F"
    echo "  · Frankfurt-P2 limpia (scanner).jpg → GT F"
    echo "  · El-Cairo-P1 (votos a mano).jpg    → GT EG (gen-gt si no existe EG-P1.txt)"
    echo "El dueño debe re-subirlas (se perdieron con el reinicio del sandbox)."
    exit 5
  fi
  if [ ! -f fotos/manifest.json ]; then
    cat > fotos/manifest.json <<'JSON'
[
  { "archivo": "Frankfurt-P2 foto campo (1).jpg", "gt": "F" },
  { "archivo": "Frankfurt-P2 foto campo (2).jpg", "gt": "F" },
  { "archivo": "Frankfurt-P2 limpia (scanner).jpg", "gt": "F" },
  { "archivo": "El-Cairo-P1 (votos a mano).jpg", "gt": "EG" }
]
JSON
    echo "[FILTROS-1] manifest.json generado (ajústalo si los nombres difieren)"
  fi
  for FOTO in fotos/*.jpg fotos/*.jpeg fotos/*.png; do
    [ -e "$FOTO" ] || continue
    "$PY" variantes.py "$FOTO" out
  done
  # GT de líneas EG: consenso UNA vez (kit §3) si aún no existe
  if [ ! -f gt/EG-P1.txt ]; then
    echo "[FILTROS-1] generando GT de líneas EG por consenso (kit §3)…"
    EG_STEM=$("$PY" - <<'PY2'
import json
rec = json.load(open("out/out/recortes.json"))
for r in rec:
    if "cairo" in r["foto"].lower() or "cairo" in r["stem"].lower():
        print(r["stem"]); break
PY2
)
    if [ -n "$EG_STEM" ]; then "$PY" bench.py out --gen-gt "$EG_STEM"; fi
  fi
  "$PY" bench.py out
  "$PY" laminas.py out
  "$PY" reporte.py out
  "$PY" zip_pack.py out "resultados/comparativa-filtros-e14"
  cp out/out/resultados.json out/out/resultados.txt resultados/ 2>/dev/null || true
fi
echo "[FILTROS-1] listo ✔ — revisa lab/resultados/ y el ZIP"
