#!/usr/bin/env bash
# check-quality.sh — GATE ÚNICO de calidad (overnight 2026-10-22, Prioridad 5
# del PLAN-overnight.md). Corre TODO lo que un commit debe pasar:
#
#   1. bunx tsc --noEmit        → 0 errores
#   2. bun run lint             → 0 errores (los 3 warnings deliberados de
#                                  §2.1 siguen permitidos: recienListas/
#                                  posCola/modoMenuMontado — decisiones D65)
#   3. bun run build            → exit 0 (Next 16 Turbopack)
#   4. bun run test             → vitest 53/53 (suite unitaria overnight)
#   5. bun scripts/qa-*.ts      → los 7 harnesses de regresión (280/280)
#   6. bunx knip                → inventario de dead code (baseline tras
#                                  overnight: 37 ítems — solo informativo,
#                                  no rompe el gate)
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
if bun run lint; then ok "lint 0 errores"; else fail "lint"; fi

paso "3/6 · Build de producción"
bun run build > /tmp/check-quality-build.log 2>&1 || { tail -15 /tmp/check-quality-build.log; fail "build"; }
ok "build exit 0 ($(grep -c 'Route' /tmp/check-quality-build.log 2>/dev/null || echo '?') rutas)"

paso "4/6 · Vitest (suite unitaria)"
bun run test || fail "vitest"
ok "vitest verde"

paso "5/6 · Los 7 harnesses de regresión (QA)"
declare -a NOMBRES=(autoenvío dedup-enviadas escaneo-ya-recortado historico-enviadas identidad-acta qr-identidad watchdog-relectura)
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

paso "6/6 · knip (informativo — baseline overnight: 37 ítems)"
knip_out="$(bunx knip 2>/dev/null || true)"
exports_=$(echo "$knip_out" | grep -A100 "Unused exports" | grep -cE "^[a-zA-Z]" || echo 0)
types_=$(echo "$knip_out" | grep -A100 "exported types" | grep -cE "^[a-zA-Z]" || echo 0)
ok "knip: ~${exports_} exports + ~${types_} types sin uso (NO rompe el gate — comparar contra AUDIT.md §6)"

printf '\n\033[1;32m══════════════════════════════════════════════\033[0m\n'
printf '\033[1;32m TODO VERDE — tsc · lint · build · vitest · QA 7/7\033[0m\n'
printf '\033[1;32m══════════════════════════════════════════════\033[0m\n'
