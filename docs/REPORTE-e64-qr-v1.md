# REPORTE — e64-qr-v1 · observabilidad + rescate de decode QR (CAPA 0)

**Kit:** `PLAN-e64-qr-implementacion-agente-v1` (+ doc hermano `INSTRUCCIONES-qr-diagnostico-y-rescate-v1`, entregado a mitad de sesión)
**Rama:** `feat/e64-qr-v1` · **Base:** `main @ f8ec6a9` (merge #73, e63m) · **Síntoma:** «no lee los QR»

---

## §0 — Qué se construyó (resumen)

FASE 0 — Observabilidad (el dueño deja de adivinar):
- **T-PRE** — reconstrucción declarada de la superficie e63n (barridos + zxing + trazaQr) que el kit presupone (ver §1).
- **T-0.1** — traza `zxing INDISPONIBLE` en el catch de `moduloZxingDe` + getter `estadoZxingQr()`.
- **T-0.2** — `qrEstado` SOLO-VISUAL en fila/registro + acción `actualizarFila` + chip `QR ✓`/`QR ✗` en MasivaView (✗ solo en LISTA).
- **T-0.3** — checklist de versión desplegada (§5.3).
- **T-0.4** — decisión de fase por evidencia existente: banco #77 midió **8.3 % decode** (ladder pre-e63n, corpus real del dueño) y banco #72 midió 88.2 % (corpus gemelas) → ambos < 90 % ⇒ **Fase 1 completa justificada** sin esperar el bench del dueño.

FASE 1 — Rescate de decode (solo `identidad-qr.ts` + QA, funciones puras):
- **T-1.0** — celda final anclada al filo inferior-derecho de cada cuadrante en los DOS barridos (hueco H-5 de hasta `paso` px).
- **T-1.1** — tier **NITIDEZ** (unsharp 3×3, `NITIDEZ_K=0.6`) entre barrido jsQR y zxing.
- **T-1.2** — tier **BINARIZADA** (umbral local por imagen integral, patrón `integridad.ts:74-100`; `BINARIZADA_VENTANA=0.025` mín 24 px, `BINARIZADA_DELTA=12`).
- **T-1.3** — `BARRIDO_VENTANAS` = `[0.08, 0.11, 0.14, 0.19, 0.25, 0.32]` (extremos del rango QR 5-8 % del ancho).
- **T-1.4** — **rescate a resolución nativa ≤4096** (`QR_LADO_LARGO_RESCATE`), SOLO si la cadena a 2048 falla y el original excede 2048: ladder base + barrido jsQR, sin zxing (64 MB puntual).
- **T-1.5** — QA headless de los tiers nuevos (Bloque 6 del QA: fixtures F1-F6 del kit).

FASE 2 — QR en el flujo de cámara (el dueño pidió ejecutar el plan completo):
- **T-2.1** — señal QR post-captura en `scanner-core-bridge.ts`: el MISMO decodificador de masiva (import dinámico), lanzado EN PARALELO al pipeline, aterrizado en `construirActa` (punto ÚNICO de las 3 rutas: success/ilegible/timeout) y estampado `qrPayload`/`qrEstado` aditivos al acta (D57). GUARD D63-C: en entradas de MASIVA se OMITE (la capa 0 del runner — cadena completa a nivel registro — manda; cero doble-costo).
- **T-2.2** — chip estático `QR ✓` en ReviewView (solo presencia, jamás payload).

FASE 3 — REPORTE (este doc) + worklog + ROADMAP + PR.

---

## §1 — DESVIACIÓN ESTRUCTURAL: la base del kit nunca se pusheó (T-PRE)

El kit cita base `main @ 9e45dc9` (e63n: barrido ceñido + zxing + trazaQr). Verificación por API
(commits, branches, PRs): **`9e45dc9` NO existe en el remoto** — main real = `f8ec6a9` (e63m #73),
cuya `identidad-qr.ts` solo tiene el ladder por BANDAS A/B/C/C1.5 + rotación. El doc hermano §1
(«Mapa del sistema QR — arquitectura REAL verificada línea a línea») describe la superficie e63n
con precisión y es la ÚNICA fuente disponible: se reconstruyó como **T-PRE** (commit `e6828d0`)
con exactamente los símbolos que el kit e64 presupone:

| Símbolo e63n (doc hermano §1) | Reconstrucción |
|---|---|
| `ladderBaseDePixeles` | refactor del bucle base del kit e63m (A→B→C→C1.5) — `ladderQrDePixeles` queda BYTE-EQUIVALENTE (QA 48/48 verde inmediato) |
| `barridoQrDePixeles` | grilla de ventanas cuadradas por cuadrante TL→TR→BL→BR × fracciones × paso 0.5, jsQR attemptBoth, early-exit, sin reló (acotado por nº de ventanas) |
| `barridoQrZxingDePixeles` | misma grilla, zxing-wasm 3.1.6, binarizadores GlobalHistogram→LocalAverage por ventana, presupuesto 4 000 ms (`performance.now() > limite`) |
| `moduloZxingDe` | `import("zxing-wasm/reader")` + `setZXingModuleOverrides({ locateFile })` con base `` `${NEXT_PUBLIC_BASE_PATH ?? ""}/wasm/` ``, caché una-tentativa (undefined→module\|null) |
| wasm local | `public/wasm/zxing_reader.wasm` (946 860 bytes) — **sha256 `5003fb4b…` verificado == `ZXING_WASM_SHA256` del paquete** (QA lo asserta en cada corrida) |
| `trazaQr` | `[e14] qr-capa0 tier=base|barrido|barrido-nitido|barrido-binarizado|zxing|rotacion90|…|null ms=… payload=xxxxxxxx…` |
| `decodificarQrDePixeles` | cadena async: base → barrido → (T-1.1) → (T-1.2) → zxing → rotación, early-exit, jamás throw |

Cuando el dueño pushee su e63n real, esta reconstrucción converge por NOMBRES (los símbolos son
los del kit); cualquier delta textual se resuelve a favor del e63n original.

## §2 — Micro-decisiones y adaptaciones declaradas (todas menores, ninguna funcional de e64)

1. **Fracción del ANCHO** — `ladoDeVentana` usa `pix.width` (el doc hermano H-6 calibra las fracciones contra «% del ancho»).
2. **Cuadrantes con frontera `floor`** — sin solapes entre cuadrantes; ventanas nunca cruzan cuadrantes.
3. **Ventana mínima 16 px** — guard degenerado para imágenes diminutas.
4. **Zxing por ventana barato** — `formats:["QRCode"]`, `tryHarder/tryRotate/tryInvert/tryDownscale=false` (la rotación y la inversión ya las cubren el tier rotación y jsQR attemptBoth; el barrido lanza cientos de ventanas, cada una debe ser barata). La restricción a QRCode es dato del dominio (el E-14 usa QR).
5. **Guard del rescate T-1.4** — el snippet del kit usa `>=` con comentario «ya era ≥4096», internamente inconsistente (pix YA viene clampeado a 2048). Se implementa el INTENT de R-4: rescate SOLO si el canvas quedó clampeado (`< QR_LADO_LARGO → return null`) — sobre un original ≤2048 el 4096 sería upscale inútil (jamás inventa detalle).
6. **Trazas del rescate con t0 local** — el kit pasa `t0=0` (produciría `ms=1.7e12`); se mide el tramo del rescate.
7. **Cámara = tiers "base"** (T-2.1) — la cadena completa (~15-17 s para sin-QR, bloques SYNC en el hilo UI) rompería el timeout 15 s del flujo individual (RECHAZADA-TIEMPO = regresión prohibida) y congelaría la vista. El tier base tiene techo ~0.5 s y es el que resuelve un QR de acta EN MANO bien encuadrada. El rescate pesado queda en masiva (timeout 120 s, donde ya está presupuestado).
8. **GUARD masiva en T-2.1** — `origenActa` es masiva-only (D63-C): allí la capa 0 del runner (cadena COMPLETA a nivel registro) manda; la señal base-only del bridge se OMITE (cero doble-costo, cero colisión de llaves en el informe — verificado que `actaLivianaJson` no hace spread del acta y la ficha del ZIP recibe actas de masiva SIN los campos de cámara).
9. **PixelesQr→ImageData** — se construye `new ImageData(w,h)` y se copia (TS 5.7: `Uint8ClampedArray<ArrayBufferLike>` no asigna a `ImageDataArray`; la copia por ventana es despreciable).
10. **Dependencia npm `zxing-wasm@3.1.6`** — primera dependencia nueva del módulo (la jsonQR sigue VENDIDA byte-idéntica; el QA asserta que package.json NO contiene "jsqr"). El wasm se sirve LOCAL desde `public/wasm/` (byte-idéntico al paquete — QA lo verifica).
11. **Bench T-0.4 bloqueado en sandbox** — las fotos reales del dueño están en su máquina; `tools/bench-qr-identidad` queda listo (export sufijo `-e64-baseline`). La decisión de fase se tomó con la evidencia existente (8.3 %/88.2 % < 90 %).

## §3 — QA (cómo correrlo)

```bash
bun scripts/qa-qr-identidad.ts   # 68/68 — 48 e63m (invariancia) + 20 e64 (Bloque 6)
```

Bloque 6 (fixtures del kit §4-T-1.5, numeración literal):

| Fixture | Condición | Resultado medido (sandbox) |
|---|---|---|
| F1 | QR anclado al filo inf-der del cuadrante TL (T-1.0) | barrido rescata payload EXACTO — 199 ms |
| F2 | blur gaussiano σ1.5, módulo 3 px: base/barrido null | NITIDEZ rescata EXACTO — 69 ms |
| F3 | gradiente 235→60, contraste QR 60: base/barrido/nitidez null | BINARIZADA rescata EXACTO — 183 ms |
| F4 | QR chico (módulo 3 px ≈ 4.2 % del ancho) a 2048 | barrido decodifica EXACTO — 6 ms |
| F5 | módulo 1 px nativo: sub-pixel a 2048 (base+barrido null) | rescate a nativa 2400×1800 decodifica EXACTO — 291 ms |
| F6 | imagen SIN QR (ruido) | cadena completa → null en 2 616 ms (< 15 s del kit) |
| — | presupuesto barrido jsQR 2048² (6 fracs) | 4 972 ms (< techo kit 5 s; sandbox bun — en hardware modesto podría cruzar 5 s: la palanca `BARRIDO_VENTANAS_ZXING` queda documentada en el kit, NO fue necesaria) |
| — | costo binarizada+scan a 2048² (kit T-1.2: ~3 s) | 3 131 ms (≈3 s — dentro del `~` del criterio) |

Más source-scan: orden de la cadena (base→barrido→nitidez→binarizada→zxing→rotación), celdas filo
en los 2 barridos, guard del rescate, trazas por tier, wiring `qrEstado` (store/runner/MasivaView),
wasm byte-idéntico, dependencia declarada. QAs de regresión: autoenvío 33/33 · escaneo 24/24 ·
identidad-acta 30/30 · watchdog 34/34.

## §4 — Gates

- `bunx tsc --noEmit` → 0 · `bun run lint` → 0 (en CADA commit).
- Build estático `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14` → OK; `out/wasm/zxing_reader.wasm` desplegado y el chunk lazy de zxing presente (el wasm NO se inline-a: se sirve del basePath).
- QA 68/68 + 33/33 + 24/24 + 30/30 + 34/34.
- Diff acotado: `identidad-qr.ts` · `tipos.ts` · `store.ts` · `runner.ts` · `scanner-core-bridge.ts` · `types.ts` (Acta) · `MasivaView.tsx` · `ReviewView.tsx` · `package.json`/`bun.lock` (zxing-wasm) · `public/wasm/` (wasm local) · `scripts/qa-qr-identidad.ts` · `docs/`. dhash/umbrales/watchdog/relectura/e63k/PWA byte-idénticos.

## §5 — Cómo probar (mini-Fase D del dueño)

1. **Consola** (carga masiva con el lote real): `[e14] qr-capa0 tier=…` por foto — el tier que ganó
   (base/barrido/barrido-nitido/barrido-binarizado/zxing/rotacionN) o `null` con su costo en ms.
2. **Chips** en la bandeja: `QR ✓` (esmeralda) / `QR ✗` (gris, solo LISTA) coherentes con la consola.
3. **Degradación zxing**: devtools → Network → bloquear `*/wasm/zxing_reader.wasm` → recargar y
   procesar: traza `zxing INDISPONIBLE … degrada a solo-jsQR` y el pipeline sigue (getters
   `estadoZxingQr()` = "indisponible").
4. **Cámara/SIM**: escanear el acta SIM (incluye QR) → REVISIÓN muestra `QR ✓ capa 0 qr` (T-2.2);
   una foto sin QR → sin chip (n/d honesto). El score/status/gate/OCR intactos.
5. **Bench (T-0.4 real)**: con el lote problemático en SU máquina —
   `bun run tools/serve-coop-coep.js 8123` → banco → export JSON/MD con sufijo `-e64-baseline`
   → comparar contra el 8.3 % del banco #77 (pre-e63n) y el 88.2 % del #72 (corpus gemelas).
6. **Deploy**: tras el merge, GH Pages re-despliega; verificar en el canónico que la consola
   muestra `tier=` (esa traza SOLO existe desde esta rama en el remoto) y que
   `zxing_reader.wasm` carga 200 (si 404 → revisar `NEXT_PUBLIC_BASE_PATH` del workflow).

## §6 — Red lines (verificación)

1. Payload OPACO — sin parse/prefijos/fuzzy en TODO el diff (QA lo asserta con regex). ✓
2. `vendor/jsQR.js` byte-idéntico — intocado (QA sha256 vs #72). ✓
3. BarcodeDetector — ausente (QA lo asserta). ✓
4. La CAPA 0 jamás throw hacia el runner/pipeline — todos los camillos nuevos terminan en null. ✓
5. Dedup jamás inventa — sin umbrales ni fuzzy; la decisión sigue siendo la igualdad EXACTA. ✓
6. Sin timers globales — el presupuesto zxing es reló local; la espera APLAZADA sigue acotada. ✓
7. Campos NUEVOS al FINAL (D57) — FilaMasiva/RegistroMasiva/Acta + spreads aditivos. ✓
8. No tocar `apps/scanner-lab` ni `packages/scanner-core` — diff sin ellos. ✓
