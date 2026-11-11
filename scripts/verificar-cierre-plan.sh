#!/usr/bin/env bash
# KIT e14-cierre (§8 del plan, VERSIÓN CORREGIDA por el documento de revisión §4)
# — batería de verificación global al cerrar la última ola.
#
# Correcciones integradas según la revisión del 2026-11-11 (C-35: el doc
# «correcciones-y-huecos-plan-remediacion.md» es de CUSTODIA LOCAL del dueño,
# no está versionado — la cita no apunta a un archivo del repo):
#  · check del receptor: 401 (contrato v0) o 410 (0.7 aplicado) — el código
#    esperado depende del orden de aplicación; /salud es healthcheck PÚBLICO
#    por diseño (0.2): SIN Bearer.
#  · GH Pages NO controla cabeceras: su CSP es <meta> y se verifica sobre el
#    HTML (no sobre headers).
#  · Orden: ejecutar el check de 0.1 (POST /v1/actas → 401) ANTES de retirar
#    el legado (0.7) — tras 0.7 el viejo endpoint da 410 y el test "parece roto".
set -uo pipefail
HUB="${HUB:-https://e14-puente.julistevan02.workers.dev}"
GH="${GH:-https://jg-stevan.github.io/digielect14}"
CF="${CF:-https://digielect14.pages.dev}"
GH_SUP="${GH_SUP:-https://jg-stevan.github.io/supervision-e14}"
TOKEN_LECTURA="${TOKEN_LECTURA:-}"

echo "═══ 1. Calidad ═══"
npx vitest run --coverage 2>&1 | tail -3
(cd packages/scanner-core && bun test --coverage 2>&1 | tail -3)

echo "═══ 2. Receptor ═══"
code=$(curl -s -o /dev/null -w "%{http_code}" "$HUB/actas")
case "$code" in
  401) echo "GET /actas: 401 sin credenciales (OK, contrato v0)";;
  410) echo "GET /actas: 410 (OK, 0.7 aplicado — verificar GET /v1/actas con credenciales)";;
  *)   echo "GET /actas: $code — REVISAR";;
esac
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -d '{}' -H "content-type: application/json" "$HUB/v1/actas")
[ "$code" = "401" ] && echo "POST /v1/actas sin firma: 401 (OK — 0.1)" || echo "POST /v1/actas sin firma: $code — REVISAR"
curl -s -o /dev/null -w "GET /salud: %{http_code} (público, sin token — 0.2.3)\n" "$HUB/salud"
code=$(curl -s -o /dev/null -w "%{http_code}" "$HUB/v1/actas")
[ "$code" = "401" ] && echo "GET /v1/actas sin token: 401 (OK — 0.2)" || echo "GET /v1/actas sin token: $code — REVISAR"
if [ -n "$TOKEN_LECTURA" ]; then
  curl -s -o /dev/null -w "GET /v1/actas con token: %{http_code}\n" -H "Authorization: Bearer $TOKEN_LECTURA" "$HUB/v1/actas"
fi
curl -s "$HUB/v1/actas/contador" | head -c 200; echo " (contador público — números sin PII)"

echo "═══ 3. Suministro ═══"
gitleaks git --log-opts="--all" && echo "gitleaks: 0 hallazgos" || echo "gitleaks: REVISAR"
npm view @jg-stevan/scanner-core version 2>/dev/null || echo "(npm view: sin red o paquete no público)"
bun audit || true   # informativo (6.1)

echo "═══ 4. Build reproducible (6.5) ═══"
# bun run build && cat .next/BUILD_ID   # dos veces → el mismo (requiere build completo)
echo "buildId configurado: $(rg -c 'generateBuildId' next.config.ts && echo sí || echo NO)"

echo "═══ 5. Datos electorales (si anonimizaste — 1.3) ═══"
git rev-list --all --objects | grep -c "acta-e14-real" 2>/dev/null || echo "0 (limpio en este clon)"

echo "═══ 6. Deploys (corregido: CSP de GH Pages se verifica sobre el HTML) ═══"
echo "— Cloudflare Pages (cabeceras reales):"
curl -sI "$CF" | grep -iE "content-security-policy|x-content-type-options|cross-origin-opener" || echo "  sin CSP/nosniff — REVISAR _headers"
echo "— GH Pages digielect14 (meta CSP en el HTML):"
curl -s "$GH/" | grep -io 'http-equiv="content-security-policy"[^>]*' | head -1 || echo "  SIN meta CSP — REVISAR layout.tsx"
echo "— GH Pages supervision-e14 (meta CSP o gemelo retirado — 6.7.3):"
curl -s "$GH_SUP/" | grep -io 'http-equiv="content-security-policy"' | head -1 || echo "  SIN meta CSP — decidir: meta o dejar de publicar el gemelo"

echo "═══ 7. Historia ═══"
git count-objects -vH | grep size-pack
echo "(coherencia con docs/DEUDA.md — cifra real: 6,17 MiB / 1.600 objetos al 7-nov-2026)"

echo "═══ Mundo físico (§12.1 fase 2 — NO scripteable) ═══"
echo "Pendiente del dueño: perfilado en dispositivo real, reproducción de U1/U3/U4"
echo "en pantalla, lector de pantalla (TalkBack/VoiceOver), set dorado de actas."
