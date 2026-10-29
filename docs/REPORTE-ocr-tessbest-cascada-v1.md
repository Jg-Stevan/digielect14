# REPORTE — KIT e14-ocr-tessbest-v1 (GO-B: Tess best primero, escalonado a PP-OCR)

**Fecha:** 2026-11 · **Rama:** `feat/e14-ocr-tessbest-cascada` · **Base:** `docs/sim-gama-baja-v2` (informe v2) → main `65dedc6`
**Petición literal del dueño:** «dejemos como primer motor de ocr tess best y escalonado a pp ocr, y sigue y sube los cambios a un pr».

## 1 · Qué hace el kit

El GO-B que el scaffold de `ocr-cascada.ts` esperaba (K3 fase 2) ya es código de
producción. La cascada del pipeline (fuera de SIM, flag `ocrCascada` **default ON**):

```
1 · TESSERACT BEST (ocr/tesseract.ts — spa 4.0.0_best, OEM LSTM_ONLY,
    vendido en public/, worker propio de la lib, budget propio)
      └─ GATE (clasificarCabecera — el MISMO juez de FASE 6)
           ├─ AUTO ⇒ listo (ahorro del re-OCR completo)
           └─ NO / fallo / presupuesto vencido ⇒ 2
2 · RapidOCR COMO SIEMPRE (1280 → necesitaSegunda → 1920 → elegirMejor)
3 · rescate ROIs top/bottom (cap 1920) → elegirMejor SOLO entre RapidOCR
```

Reglas intocables del brief K3: entre motores decide el GATE (el texto de Tess
JAMÁS entra a `elegirMejor`); `elegirMejor` SOLO compara pasadas RapidOCR;
cualquier fallo del gate ⇒ MANUAL (jamás tumba); presupuesto del pipeline manda.

### Caída honesta (sin doble pago)
`intento1` intenta Tess y ante CUALQUIER fallo (red, wasm, presupuesto) corre la
1.ª pasada RapidOCR 1280 de siempre **marcada `motor:"rapidocr"`** — la cascada
la REUSA (nunca se paga dos veces la misma pasada). Contrato nuevo aditivo:
`PasadaCascada.motor` + `cap "tess"` + `SalidaCascada.motorIntento1` (traza
`intento1=tess-best|1280`). Retro-compat byte-idéntica: pasada sin `motor` =
`"rapidocr"`.

### Vendido (cero CDN en producción — patrón vendor/onnxruntime)
| Asset | Ruta pública | Peso |
|---|---|---|
| `tesseract.js@5.1.1` worker | `/vendor/tesseract/worker.min.js` | 124 KB |
| core SIMD-LSTM (glue + wasm) | `/vendor/tesseract/tesseract-core-simd-lstm.{wasm.js,wasm}` | 6.8 MB |
| `spa` traineddata **BEST** | `/models/tess/spa.traineddata.gz` | 12 MB |

El SW (`sw.js`) cachea `/models/tess/` y `/vendor/tesseract/` en MOTOR_CACHE al
primer uso (offline desde la 1.ª cascada con éxito, igual que RapidOCR ~30 MB).
`tesseract.js` entra como dependencia real pero viaja por **import dinámico** —
el bundle principal no lo descarga hasta la 1.ª cascada.

### Presupuestos (por tier — el fix del P0 del informe sim-gama-baja)
`adaptacion/plan.ts` suma 3 knobs RESUELTOS por tier (override manual del dueño
manda vía el flag nuevo `presupuestoEscaneoMs`; kill-switch
`adaptacionDispositivo:false` ⇒ valores históricos byte-idénticos):

| Knob | ALTO (histórico) | MEDIO | BAJO | Evidencia |
|---|---|---|---|---|
| Pipeline individual (`presupuestoEscaneoEfectivo`) | 120 s (e67) | 240 s | 480 s | sim v2/v3: mono-hilo 6× necesita ~125 s y el fijo 120 s rechazaba 0.0 |
| Probe de orientación (`presupuestoProbeOrientacionEfectivo`) | 12 s (D56) | 60 s | 150 s | v5-v7: el t0 compartido se agota con descargas de fondo |
| Espera warm-up worker OpenCV (`esperaWorkerEfectiva`) | 5 s (masiva-ux T1) | 10 s | 20 s | v4: compile wasm a 6× no cabe en 5 s |

### Prewarm encadenado (ScanView)
`rapidOcrPrecalentar()` resuelve ⇒ **entonces** `tessPrecalentar()` (solo con la
cascada ON): la descarga vendida de Tess (~19 MB) no compite por el enlace con
los modelos del 1.er escaneo (v6: la descarga concurrente agotaba el t0 del
sondeo de orientación). Idempotente + silencioso + fire-and-forget.

## 2 · Verificación (browser real, headless + CDP)

Perfil gama baja del informe v2 (CPU 6× · 2 GB · 4 núcleos · 3G · mono-hilo),
flujo completo con el acta real del repo (`evidence/sim-recursos/`):

| Corrida | Build | Resultado |
|---|---|---|
| v4 (`sim-lowend-v4`) | kit 1.ª iteración | Tess vencido en creación (60 s < descarga 3G 19 MB) → caída honesta ✓ · pipeline TERMINA 215.6 s, score real 4.9 (antes timeout → 0.0) |
| v7 (`sim-lowend-v7`) | kit final | **`tess-best intento1 ok conf=0.81 chars=338`** · cascada completa · pipeline 221.9 s < 240 s · score 4.9 · sondeo evalúa 3 rotaciones (antes 1) · 0 errores JS |
| A/B (`sim-ab-killswitch`) | **kill-switches ON (byte-idéntico a main)** | **mismo corte pre-existente**: `cabeceraE14=false recortada=1 lado=sup` + probe cortado — en main quedaba enmascarado por el timeout (0.0 a los 120 s) |

**Lectura honesta:** el kit CUMPLE lo pedido (Tess best primero + escalonado a
PP-OCR + el pipeline ya no muere por presupuesto en gama baja: score REAL
calculado). El rechazo restante del simulador (cabecera cortada con red
throttled en la 1.ª descarga de modelos) es **PRE-EXISTENTE en main** (probado
con el A/B) y necesita kit propio: visibilidad del origen det (worker/sobel) en
la traza del pipeline + presupuesto de primera-descarga + revisión del quad bajo
starvation. El 10.0 histórico se midió SIN throttling de red.

## 3 · Gates
- `bunx tsc --noEmit` — 0 · `bun run lint` — 0/0 · `bun run test` — **239/239**
  (233 históricos + 6 nuevos: GO-B gate/reuso/caída/retro-compat + flags del
  presupuesto).
- QA harnesses: autoenvío 21/21 · obs-contract 38/38 · obs-transporte 8/8 ·
  obs-privacidad 7/7 · obs-ui 7/8 · aa-quickwins 10/11 — **los 2 fallos son la
  deuda pre-existente de main** (documentada en el worklog de F-LENS v5).

## 4 · Kill-switches (D6 — la decisión manual del dueño manda)
- `{"ocrCascada": false}` — cascada OFF: OCR escalonado de siempre byte a byte,
  Tess ni se menciona (ni prewarm ni descarga).
- `{"adaptacionDispositivo": false}` — presupuestos históricos exactos
  (120 s / 12 s / 5 s).
- `{"presupuestoEscaneoMs": N}` — override MANUAL del presupuesto del pipeline
  (clamp 30-900 s; DOBLE whitelist sanearFlags + politica).

## 5 · Pendientes (dueño)
1. Kit «primera-descarga» (P1 del A/B): traza `origen=` del det, presupuesto de
   primera descarga y revisión del quad bajo starvation de red.
2. Validación de campo en el sm-a135m/ds físico (la simulación es aproximación).
3. Confirmar en campo que Tess best sube el score/gate vs RapidOCR con las actas
   reales del lote del dueño (el bench `tools/bench-ocr-cascada/` queda disponible).
