# Q-54 — Triage de avisos de lint (2026-11-12)

Estado de `bun run lint` (eslint .) en el cierre del plan: **0 errores /
16 warnings** en el baseline. Cada aviso tiene decisión: CORREGIDO o
DELIBERADO. Los corregidos desaparecen del lint; los deliberados siguen
saliendo y esta tabla es su decisión anotada (criterio literal del plan:
«0 avisos sin decisión anotada»).

| # | aviso (archivo:línea) | regla | decisión | detalle |
|---|---|---|---|---|
| 1 | `packages/scanner-core/src/dominio/fusion.ts:315` | no-unused-vars (`agregarMun`) | **CORREGIDO** | función flecha huérfana de una refactorización del `poolDeCandidatos` — eliminada (sin uso, cero cambio de comportamiento). Espejo byte-a-byte en supervision-e14. |
| 2 | `packages/scanner-core/src/dominio/fusion.ts:325` | no-unused-vars (`mun`) | **CORREGIDO** | `for (const [mun, lista] …)` → `for (const [, lista] …)` (el bloque solo usa `lista`). Espejo byte-a-byte en supervision-e14. |
| 3 | `packages/scanner-core/src/ocr/rapidocr.ts:171` | no-explicit-any | **CORREGIDO** | `(window as any).__E14_ORT_CONFIG__` → `(window as unknown as { __E14_ORT_CONFIG__?: unknown })` — mismo patrón del consumidor (`src/lib/e14/ocr/rapidocr.ts:63`). Runtime idéntico. Espejo byte-a-byte en supervision-e14. |
| 4 | `packages/scanner-core/tests/cascada.test.ts:33` | no-unused-vars (`lee`) | **CORREGIDO** | los describes source-scan se mudaron al repo de la app (comentario final del test) — se elimina la cadena huérfana `lee` + `raiz` + imports `readFileSync`/`fileURLToPath` + su comentario. Espejo byte-a-byte en supervision-e14. |
| 5 | `src/components/e14/dev/PanelDev.tsx:338` | exhaustive-deps (`overrides` «unnecessary») | **DELIBERADO** | `useMemo(() => leerFlags(), [overrides])`: el linter no ve la relación porque `leerFlags()` lee el estado global de flags (defaults + overrides) por side-channel; `overrides` es el disparador de recálculo intencional. Quitarlo congelaría el panel con flags viejas. |
| 6 | `src/components/e14/dev/PanelDev.tsx:365` | exhaustive-deps (`overrides` «unnecessary») | **DELIBERADO** | `useMemo(() => planAdaptativo(), [overrides])`: mismo patrón side-channel — el plan se computa del estado global (perfil + overrides). La dep es el trigger intencional. |
| 7 | `src/components/e14/hooks/useAnilloBestShot.ts:170` | exhaustive-deps (falta `videoRef`) | **DELIBERADO** | el callback corre dentro del rAF del loop de cámara; `videoRef` es una ref estable (identidad constante), añadirlo no cambia nada y el callback ya lee `.current` — patrón deliberado del hook. |
| 8 | `src/components/e14/hooks/useAnilloBestShot.ts:194` | exhaustive-deps (falta `videoRef`) | **DELIBERADO** | idem #7. |
| 9 | `src/components/e14/hooks/useDestello.ts:283` | exhaustive-deps (falta `sensorProfileRef`) | **DELIBERADO** | ref estable leída por `.current` dentro del callback; incluirla es ruido sin efecto. |
| 10 | `src/components/e14/hooks/useLinterna.ts:97` | exhaustive-deps (falta `streamRef`) | **DELIBERADO** | ref estable leída por `.current`; el callback vive el ciclo de vida del stream y se re-arma solo por sus deps reales. |
| 11 | `src/components/e14/hooks/useSesionCamara.ts:653` | exhaustive-deps (falta `sensorProfileRef`) | **DELIBERADO** | refs estables + callbacks re-creados por render: añadirlos re-identificaría el callback en cada render y re-armaría el chain de captura. |
| 12 | `src/components/e14/hooks/useSesionCamara.ts:756` | exhaustive-deps (faltan `sensorProfileRef` y `streamRef`) | **DELIBERADO** | idem #11. |
| 13 | `src/components/e14/hooks/useSesionCamara.ts:1125` | exhaustive-deps (faltan 12 deps) | **DELIBERADO** | effect de arranque del loop de cámara (una vez por sesión): mezcla refs estables y funciones del cuerpo del hook (`mostrarAviso`, `setCamEstado`, `setFramePendiente`…). Incluirlas re-ejecutaría el setup del pipeline de frames — el estado fresco ya llega por refs internas (`flashRef`, `procesandoRef`, `cooldownRef`…). Cambiarlo es refactor de cámara, no fix de lint. |
| 14 | `src/components/e14/hooks/useSesionCamara.ts:1136` | exhaustive-deps (faltan `streamRef` y `videoRef`) | **DELIBERADO** | idem #13 (setup de stream). |
| 15 | `src/components/e14/hooks/useSesionCamara.ts:1152` | exhaustive-deps (faltan 4 deps) | **DELIBERADO** | idem #13 (torcha/linterna guardada). |
| 16 | `src/components/e14/hooks/useSesionCamara.ts:1221` | exhaustive-deps (faltan 9 deps) | **DELIBERADO** | idem #13 (loop principal de frames con rAF). |

## Notas

- Los #1–#4 son los ÚNICOS toques a `packages/scanner-core/**` del cierre
  (REGLA CRÍTICA del plan): fixes triviales de lint, cero cambio de
  comportamiento, replicados byte-a-byte en `supervision-e14`.
- Con #3 corregido, `@typescript-eslint/no-explicit-any` queda con 0 avisos
  en todo el repo (candidato a subir de `warn` a `error` en una ola futura —
  no se hace aquí porque cambia el gate).
- Los #5–#16 comparten patrón (`react-hooks/exhaustive-deps`) en hooks de
  cámara/panel: el valor fresco llega por refs y las deps «extra» serían
  re-armado de callbacks/effects de captura. NO silenciados con
  eslint-disable: la decisión queda anotada aquí y en el código de cada hook
  ya se documenta el patrón de refs internas.
- Verificación final: `bun run lint` → 0 errores / 12 warnings (los #5–#16
  deliberados) · `bunx tsc --noEmit` → 0 errores.

## Sección knip (C-6.3 del plan de cierre 2026-11-12)

`knip@5.44.1` (ya declarado en devDependencies) quedó configurado en `knip.json`
con cobertura completa de entries (tests `*.test.{ts,tsx}`, e2e `*.spec.ts`,
scripts qa/gen/build/smoke, worker de heartbeat, `open-next.config.ts`) y el
workspace `packages/scanner-core` con su contrato real: el `exports` map del
paquete expone **cada** `src/*.ts` como subpath público (`"./*": "./src/*.ts"`),
así que el entry del workspace es `src/**/*.ts` + workers + scripts.

Resultado: 0 archivos sin usar · 0 dependencias sin usar · 0 binarios sin
declarar · exports/tipos restantes **en nivel `warn` (no bloqueante)**, triados
así:

1. **Superficie de la capa e14 vendorizada** (`src/lib/e14/core/*`:
   pdf-export, pwa, quality, sensor-profiler, frame-loop, motion-stabilizer):
   helpers/constantes/tipos del trasplante (D83/D94) que comparten contrato con
   las variantes del repo hermano — no se podan en el cierre.
2. **Catálogos**: `src/components/e14/icons.tsx` (iconos aún no usados) y las
   constantes HEIC de `useDestello.ts` — catálogo deliberado.
3. **Observabilidad/uso** (`obs/export.ts`, `obs/uso.ts`, `obs/captura.ts`,
   `obs/lcp-cls.ts`): helpers del contrato observable que los reportes
   consumen desde fuera del grafo estático.
4. **Alias semántico**: `TECHO_ESCUDO_FONDO = TECHO_ADVERTENCIA`
   (`politica/umbrales.ts`) — alias de intención, NO duplicado accidental.

`ignoreDependencies` documentados: `heic2any`, `onnxruntime-web`, `tesseract.js`
y `zxing-wasm` — importados dinámicamente DENTRO del paquete vendorizado pero
declarados en la raíz por decisión explícita del ancla T-16 de paridad
(`scripts/qa-paridad-motor.ts` §"Sus imports DINÁMICOS…"): quitarlos «porque no
aparecen en ningún import de src/» deja el build verde y revienta el HEIC de un
iPhone en runtime. `@testing-library/*`: el test de componente está INACTIVO
por bloqueos documentados (`src/lib/e14/__tests__/review-view.copy.test.ts` y
`docs/PENDIENTES-INTEGRACION.md`).

Adición justificada (knip la destapó): `@playwright/test` entra a
devDependencies — `e2e/humo.spec.ts` ya lo importaba SIN declarar (dependía de
`bunx` temporal); ahora el contrato de dependencias del e2e es explícito.

Verificación: `bunx knip` → **exit 0** (63 líneas de avisos warn documentados
en esta sección) · `bun run lint` → 0 errores · `bunx tsc --noEmit` → 0 errores.
