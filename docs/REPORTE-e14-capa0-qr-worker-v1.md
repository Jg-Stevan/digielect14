# REPORTE — KIT e14-capa0-qr-worker-v1 (port del D40+R1.1+R1.4-b de supervision-e14)

**Fecha:** 2026-10-30 · **Rama:** `feat/e14-capa0-qr-worker-v1` (base `b9465a6`) · **Estado:** listo para QA del dueño

## 1 · Problema

La capa 0 QR de la CÁMARA corre en el hilo UI y SOLO ejecuta el tier `base`
del ladder (`decodificarQrDeCapture(fotoOriginal, { tiers: "base" })`, techo
~0.5 s — decisión del kit e64 T-2.1: la cadena completa ~15-17 s SYNC
congelaría la vista). Consecuencias:

1. **Cobertura baja en cámara** — QR en fotos duras (arrugadas, sombra,
   blur) necesita los tiers pesados (barrido/nitidez/binarizada/rotaciones/
   rescate 4096) que la cámara nunca paga.
2. **Congelones del hilo UI** durante el ladder base en dispositivos gama
   baja (el informe IA ya lo señalaba: «OffscreenCanvas disponible:
   candidato futuro para mover el pre-procesado fuera del main thread»).

El hermano `supervision-e14` resolvió AMBOS en su módulo masiva con el kit
D40 (worker) + R1.1 (presupuesto real) + R1.4-b (telemetría de fases), con
A/B medido en campo: capa QR −42%, peor caso 31 s → 12.5 s, cero
regresiones. Este kit porta EXACTAMENTE esa solución al flujo individual.

## 2 · Diseño (qué cambió y qué NO)

### NUEVOS
| Archivo | Qué es |
|---|---|
| `src/lib/e14/qr/capa0-qr.worker.ts` | WORKER de la cadena: base → recorte-600 → barrido → barrido-nitido (unsharp 3×3) → barrido-binarizado (umbral local integral) → rotaciones 90/180/270 → rescate 4096. Presupuesto de pared con guard R1.1 (por cuadrante/fracción/rotación/rescate). Respuesta con `fases` + `fin` (R1.4-b). jsQR-only (RED LINE e73 §I: zxing jamás en el worker). |
| `src/lib/e14/qr/capa0-qr.client.ts` | Cliente con hard-kill anti-zombi (presupuesto+1500 ms → terminate + respawn perezoso), feature-detect, flag kill-switch, y el WRAPPER de cámara `decodificarQrCapa0Camara(dataUrl)`: presupuesto por tier del plan (unificada **8 s** · BAJO **5 s** sin rescate 4096 — floor anti-OOM, lección INVALID SESSION móvil), telemetría pasiva `[e14] qr-capa0-worker tier=… ms=… fin=… fases=…`, y fallback al camino de HOY (tiers "base") si el worker no corrió. |
| `scripts/build-capa0-worker.mjs` | Build del artefacto IIFE a `public/scanner/capa0-qr.worker.js` (patrón heartbeat — Turbopack emitiría el .ts crudo). `prebuild` en package.json. |
| `scripts/smoke-capa0-qr-worker.mjs` | Smoke del gate: FRESCURA byte a byte + MARCADORES + PROHIBIDOS (import(/process.env/localStorage/zxing). Cableado en check-quality.sh paso 4. |
| `public/scanner/capa0-qr.worker.js` | Artefacto comprometido (134.9 KB, jsQR vendido inline). |

### EDITADOS (aditivos — cero diffs de comportamiento con flag OFF)
| Archivo | Cambio |
|---|---|
| `src/lib/e14/qr/qr-pixeles.ts` | +`activarGuardBarrido` (R1.1 — sin guard el chequeo interno es `false`, byte-idéntico) · +`ladderBaseDePixeles`/`nitidezQrDePixeles`/`binarizadaQrDePixeles` MOVIDAS byte a byte desde identidad-qr.ts (misma doctrina D40: el worker las importa como módulo puro jsQR-only). `barridoQrDePixeles` gana 3 chequeos de guard. |
| `src/lib/e14/qr/identidad-qr.ts` | Retira las definiciones movidas y RE-EXPORTA (cero diffs en consumidores). |
| `src/lib/e14/scanner-core-bridge.ts` | El bloque e64-qr T-2.1 de cámara consume `decodificarQrCapa0Camara`; el catch conserva el camino de hoy byte-idéntico. |
| `src/lib/e14/{flags,obs/tipos}.ts` + `flags-ejemplo.json` | Flag `capa0QrWorker` (default **true**, kill-switch del dueño: false = hoy byte a byte). Whitelist aditiva. |
| `package.json` | `prebuild` (el artefacto va COMMITTEADO — el hook es guardia, no requisito). |
| `scripts/check-quality.sh` | Smoke de capa 0 en el gate. |
| `src/lib/e14/flags.test.ts` | Ancla de defaults +`capa0QrWorker: true` (patrón de cada kit). |

### LO QUE NO CAMBIA (red lines)
- `@jg-stevan/scanner-core` intocable. Negocio intacto: score, gate,
  clasificación, desenlaces, intentos — el QR es SEÑAL ADITIVA (e64).
- El fallback de cámara (flag OFF / sin Worker / hard-kill) es el bloque de
  HOY byte a byte.
- zxing-wasm sigue en MAIN (identidad-qr) — la cadena del worker es
  jsQR-only y su cobertura es estrictamente ⊇ del tier "base" de hoy.

## 3 · Cobertura y latencia (honestidad)

| Escenario | HOY (flag OFF) | CON kit (flag ON) |
|---|---|---|
| QR en tier base | 0.3-0.5 s en main | igual, pero en worker (UI fluida) |
| QR en tiers pesados | NO se intenta → sin payload | worker lo intenta con presupuesto 8 s (BAJO 5 s) — en PARALELO al OCR (15-120 s), el peor caso cabe dentro del pipeline; el QR ✓ alimenta brújula/identidad |
| Sin QR | null tras base | `fin=agotado` tras TODA la cadena jsQR (null REAL, telemetría lo distingue de un corte) |
| Hilo UI | ladder base sync | CERO bloques del QR |

## 4 · Gates ejecutados

- `bunx tsc --noEmit` → **0 errores**
- `bun run lint` → **0 errores / 0 warnings**
- `bun run test` → vitest **239/239** (incluye ancla de flags actualizada)
- `bun scripts/build-capa0-worker.mjs` → OK (134.9 KB)
- `bun scripts/smoke-capa0-qr-worker.mjs` → **TODO OK** (frescura byte a
  byte + marcadores + prohibidos)

## 5 · Cómo probar

1. **A/B kill-switch:** `localStorage.setItem("e14-flags-overrides", '{"capa0QrWorker": false}')` → todo byte-idéntico a main (consola SIN
   `qr-capa0-worker`).
2. **Kit ON (default):** escanear un acta → consola `[e14] qr-capa0-worker
   tier=base|recorte-600|barrido|… ms=… fin=payload fases={…}`; en el peor
   caso sin QR, `fin=agotado` con el desglose de fases.
3. **Cobertura:** una foto que HOY da QR ✗ (dura/sombra) debería pasar a QR
   ✓ vía barrido/nitidez/binarizada; la brújula de orientación y la
   identidad reciben la señal más temprano.
4. **Gama baja:** en perfil 6× el presupuesto baja a 5 s y el rescate 4096
   se apaga (floor anti-OOM) — verificar en la traza `presupuestoVencido=0`
   y `fases` sin `rescate4096`.

## 6 · Pendiente (kits siguientes, ya mapeados en el PLAN del port)

- **Kit 2** `e14-qr-cadena-completa-tiers-v1`: knobs del plan (`qrCapa0Nivel`/
  `qrCapa0PresupuestoMs`/`qrCapa0Rescate4096`) con override manual D6 — hoy
  los defaults viven en el wrapper.
- **Kit 3** `e14-qr-fases-telemetria-v1`: `fases`/`fin`/`qrPresupuestoMs`
  hacia el informe IA (PanelDev §9) — hoy solo consola.
- **Kit futuro**: rescate zxing en main cuando el worker da null (cobertura
  EXACTA de la masiva) — decide la telemetría.
- Bench con fotos reales del dueño (`tools/bench-qr-identidad`) para medir
  % decode antes/después.
