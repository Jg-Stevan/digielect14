#!/usr/bin/env bash
# Regenera el bundle CONGELADO del banco (KIT e14-bench-ocr-cascada-v1 — K3).
# Correr desde tools/bench-ocr-cascada/ o desde la raíz del repo.
# El bundle re-exporta módulos REALES de src/ — regenerar tras cada cambio
# de src/ que toque rapidocr/clasificador/divipol/ocr-escalonado/prescan.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p vendor
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo desconocido)"
"$(git rev-parse --show-toplevel)/node_modules/.bin/esbuild" entry-bench.ts \
  --bundle \
  --format=esm \
  --define:process.env.NODE_ENV='"development"' \
  --target=es2020 \
  --outfile=vendor/bench-kit.congelado.js

# ── Parche SOLO-BANCO del bundle (el bundler de la app resuelve esto; el
#    bundle congelado de una sola pieza NO sobrevive el contexto worker de
#    ORT): ORT 1.30 re-ejecuta el MISMO bundle como module worker para su
#    proxy worker y sus pthreads em-pthread — y el top-level del bundle
#    (heic2any → `window.__heic2any__worker`, módulos de la app con DOM)
#    explota dentro del worker → «Failed to load proxy worker». Solución
#    honesta: el banco corre la inferencia en el MAIN THREAD (proxy=false,
#    numThreads=1) — MISMO wasm, MISMO EP, MISMOS modelos y MISMO resultado
#    (determinismo wasm del kit); el timing relativo A/B/C queda válido
#    porque los 3 arms corren con el MISMO sesgo. El patch solo toca las DOS
#    asignaciones de rapidocr.ts dentro del bundle (verificadas: 1 y 1).
perl -0777 -i -pe '
  s/\.env\.wasm\.proxy = true/.env.wasm.proxy = false/;
  s/ort\.env\.wasm\.numThreads = typeof SharedArrayBuffer[^;]+;/ort.env.wasm.numThreads = 1;/s;
' vendor/bench-kit.congelado.js
grep -q "\.env\.wasm\.proxy = false" vendor/bench-kit.congelado.js
grep -q "ort.env.wasm.numThreads = 1;" vendor/bench-kit.congelado.js

# Cabecera de procedencia (el commit del bundle = commit fuente de la copia).
{
  echo "/* CONGELADO — KIT e14-bench-ocr-cascada-v1 (K3 fase 1) — generador: generar-vendor.sh"
  echo " * FUENTE: src/lib/e14/{clasificador,divipol,ocr/rapidocr,ocr-escalonado,senal-lectura,masiva/prescan-qr.client}.ts"
  echo " * COMMIT FUENTE: ${COMMIT} · entry: tools/bench-ocr-cascada/entry-bench.ts (regen: ./generar-vendor.sh)"
  echo " * FORMATO: ESM (import.meta.url requerido por ORT — en IIFE «cannot"
  echo " * determine the script source URL»). Carga:"
  echo " * <script type=\"module\">import * as B from './vendor/bench-kit.congelado.js';</script>"
  echo " * PATCH SOLO-BANCO (ver generar-vendor.sh): proxy=false + numThreads=1 —"
  echo " * inferencia en el MAIN THREAD (ORT re-ejecuta el bundle como worker y el"
  echo " * top-level del bundle de una sola pieza no sobrevive ese contexto)."
  echo " * MISMO wasm/EP/modelos — resultado idéntico; timing relativo A/B/C válido."
  echo " * ARTEFACTO de build para el banco (igual criterio vendor que"
  echo " * tools/bench-qr-identidad/jsQR.js) — NO editar a mano. */"
  cat vendor/bench-kit.congelado.js
} > vendor/bench-kit.congelado.js.tmp && mv vendor/bench-kit.congelado.js.tmp vendor/bench-kit.congelado.js
echo "vendor/bench-kit.congelado.js regenerado (commit fuente ${COMMIT})"
