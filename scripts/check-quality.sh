#!/usr/bin/env bash
# check-quality.sh — GATE ÚNICO de calidad (overnight 2026-10-22, Prioridad 5
# del docs/archive/PLAN-overnight.md). Corre TODO lo que un commit debe pasar:
#
#   1. bunx tsc --noEmit        → 0 errores
#   2. bun run lint             → 0 errores / 0 warnings (desde PR #93 NO
#                                  hay warnings deliberados: recienListas/
#                                  posCola/modoMenuMontado quedaron resueltos
#                                  en ui-hooks-v1, y la única preexistente
#                                  de logger.ts la eliminó el núcleo del
#                                  agente 1 — obs-flags-qa FASE 1)
#   3. bun run build            → exit 0 (Next 16 Turbopack)
#   4. bun run test             → vitest verde (162: base overnight 70 +
#                                  núcleo obs/flags 83 + transporte 9)
#   5. bun scripts/qa-*.ts      → los 12 harnesses (11 históricos + qa-aa-quickwins): 7 de regresión
#                                  (294 checks — anclas byte-idénticas de
#                                  runner/cola/historico) + 4 de contrato
#                                  obs del kit e14-observabilidad-v1
#                                  (contract 38 · privacidad 7 · transporte
#                                  8 · ui 8 — la de ui nace PENDIENTE en la
#                                  base feat/obs-nucleo-v1 y pasa a ESTRICTO
#                                  al integrar feat/obs-modo-dev-v1)
#   6. bunx knip                → inventario de dead code (informativo —
#                                  no rompe el gate; baseline 40 ítems =
#                                  25 exports + 17 types tras FASE 1,
#                                  superficie de contrato obs incluida —
#                                  ver docs/REPORTE-obs-flags-qa-v1.md)
#
# Uso:    bash scripts/check-quality.sh
# Sale:   exit 0 si TODO verde; primer fallo corta con contexto.
# Nota:   los QA validan ANCLAS DE FUENTE (lección 3A.1) — por eso este
#         gate corre CONTRA EL ÁRBOL COMMITEADO (ver lección e65 T-6: un
#         source-scan sobre el working tree puede dar verde con cambios
#         sin commitear). Commitea (o stash) antes de fiarte del verde.

set -uo pipefail
cd "$(dirname "$0")/.."

paso() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31m✗ FALLO: %s\033[0m\n' "$1"; exit 1; }

paso "1/6 · TypeScript (tsc --noEmit)"
bunx tsc --noEmit || fail "tsc — ver salida arriba"
ok "tsc 0 errores"

paso "2/6 · ESLint"
if bun run lint; then ok "lint 0 errores / 0 warnings"; else fail "lint"; fi

paso "3/6 · Build de producción"
bun run build > /tmp/check-quality-build.log 2>&1 || { tail -15 /tmp/check-quality-build.log; fail "build"; }
ok "build exit 0 ($(grep -c 'Route' /tmp/check-quality-build.log 2>/dev/null || echo '?') rutas)"

paso "3bis/6 · Smoke de bundling del worker de sondeo (FIX DICTAMEN-e73 §3.2 — jamás verde falso)"
# Lección del dictamen: «exit 0 no es worker compilado» — Turbopack emitía el
# .ts crudo como asset. Este smoke afirma: artefacto FRESCO (byte-idéntico a
# la regeneración) · marcadores del ladder · PROHIBIDOS ausentes (import(
# / zxing / process.env) · cliente sin .ts en media y apuntando al .worker.js.
bun scripts/smoke-sondeo-worker.mjs || fail "smoke sondeo-worker (worker NO compilado de verdad)"
ok "worker de sondeo precompilado, fresco y jsQR-only · cliente limpio"

paso "3ter/6 · Smoke de bundling del worker de heartbeat (KIT e14-obs-hang-atribucion-v1 §C.1)"
# El §C.1 re-confirmó la lección e73: Turbopack emitió el .ts CRUDO como
# asset (verde falso). Mismo guard que el 3bis: artefacto FRESCO (byte a
# byte) · marcadores del guardián · PROHIBIDOS ausentes (import( / process.
# env / console. / localStorage) · CLIENTE sin .ts en media y apuntando al
# .worker.js precompilado.
bun scripts/smoke-heartbeat-worker.mjs || fail "smoke heartbeat-worker (worker NO compilado de verdad)"
ok "worker de heartbeat precompilado y fresco · cliente limpio"

paso "4/6 · Vitest (suite unitaria)"
bun run test || fail "vitest"
ok "vitest verde"

paso "5/6 · Los 12 harnesses de regresión + contrato obs + AA quickwins (QA)"
# Orden ALFABÉTICO EXACTO del glob scripts/qa-*.ts (los 4 obs-* entran
# entre identidad-acta y qr-identidad) — NOMBRES[i-1] debe corresponder 1:1
# con el i-ésimo archivo del glob (kit A3-C5).
declare -a NOMBRES=(aa-quickwins autoenvío dedup-enviadas escaneo-ya-recortado historico-enviadas identidad-acta obs-contract obs-privacidad obs-transporte obs-ui qr-identidad watchdog-relectura)
i=0
for f in scripts/qa-*.ts; do
  i=$((i+1))
  nombre="${NOMBRES[$((i-1))]:-$(basename "$f")}"
  out="$(bun "$f" 2>&1)"; rc=$?
  linea="$(echo "$out" | tail -1)"
  if [ $rc -ne 0 ] || ! echo "$linea" | grep -q "OK"; then
    echo "$out" | tail -8
    fail "QA $nombre"
  fi
  ok "$nombre — $linea"
done

paso "6/6 · knip (informativo — baseline FASE 1: 40 ítems = 25 exports + 17 types)"
knip_out="$(bunx knip 2>/dev/null || true)"
exports_=$(echo "$knip_out" | grep -A100 "Unused exports" | grep -cE "^[a-zA-Z]" || echo 0)
types_=$(echo "$knip_out" | grep -A100 "exported types" | grep -cE "^[a-zA-Z]" || echo 0)
ok "knip: ~${exports_} exports + ~${types_} types sin uso (NO rompe el gate — comparar contra docs/REPORTE-obs-flags-qa-v1.md §FASE 1)"

printf '\n\033[1;32m══════════════════════════════════════════════\033[0m\n'
printf '\033[1;32m TODO VERDE — tsc · lint · build · vitest · QA 12/12\033[0m\n'
printf '\033[1;32m══════════════════════════════════════════════\033[0m\n'
