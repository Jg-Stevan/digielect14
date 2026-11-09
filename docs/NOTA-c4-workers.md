# NOTA C4 — Workers que no mueren (P1 #10 + P2 #15) — KIT e14-remediacion-movil-v1

## 1 · Inventario de workers y nombres nuevos (fin de los targets mudos)

| Worker | Artefacto | Creado en | `name` nuevo |
|---|---|---|---|
| CAPA 0 QR (jsQR puro) | `public/scanner/capa0-qr.worker.js` (IIFE; fuente `workers/capa0-qr.worker.ts`) | `packages/scanner-core/src/qr/capa0-qr.client.ts` | `capa0-qr-v1` |
| Detección de precisión (OpenCV.js WASM) | `public/scanner/detection-worker.js?v=8` | `packages/scanner-core/src/core/detector-client.ts` | `detection-precision-v1` |
| Fallback canvas/warp/filtros | `public/scanner/fallback-canvas.worker.js` | `packages/scanner-core/src/core/image-processor.ts` | `fallback-canvas-v1` |
| Sensor de hang (obs) | `public/scanner/heartbeat.worker.js` | `src/lib/e14/obs/heartbeat.client.ts` | `heartbeat-obs-v1` |

No nombrables (terceros, sin opción `name` en su API): el **proxy worker de
onnxruntime-web** (`ort.env.wasm.proxy = true`, rapidocr.ts — el DedicatedWorker
mudo del hallazgo (a)) y el **worker interno de tesseract.js**. El service
worker (`sw.js`) no es `new Worker`.

## 2 · Instrumentación que quedó

- Ciclo de vida (paquete, logger con patrón `[e14] …`):
  - crear/respawn: `[e14] worker=capa0-qr accion=crear|respawn name=capa0-qr-v1 kills=N` (logger.info — SOLO dev, política del logger).
  - hard-kill (warn SIEMPRE + transportado al buffer obs `e14-obs` como LoggerWarn):
    `[e14] worker=capa0-qr accion=hard-kill kills=N name=capa0-qr-v1 presupuesto=8s+1500 …`.
- Contador de cuelgues por sesión de página: `hardKillsQrWorker(): number`
  (contador de módulo del cliente QR) + campo defensivo
  `window.__e14Telemetria.qrWorkerHardKills` (estampado por useSesionCamara con
  import perezoso; `undefined` hasta que el cliente QR cargó; también viaja
  por el `export *` del wrapper de app `src/lib/e14/qr/capa0-qr.client.ts`).

## 3 · Análisis del colgado del QR (3/3 en medición, hard-kill ya activo)

Síntoma: `RuntimeError: Aborted()` desde `e.onmessage` (familia emscripten), con
el `terminate()` a `presupuesto+1500 ms` ya vigente en `capa0-qr.client.ts`.

1. **El bundle del worker QR NO puede originar ese error**: es jsQR vendido
   (puro JS — red line §I), sin wasm/emscripten en el artefacto (grep + smoke,
   que prohíbe `import(` y `zxing`). Un `Aborted()` nace SOLO de un módulo
   emscripten ya abortado.
2. **Hipótesis #1 — OOM de zxing-wasm en MAIN durante el rescate post-kill**:
   tras el hard-kill el caller paga el rescate zxing (`identidad-qr.ts` →
   `qr-zxing.ts`, módulo emscripten en el hilo principal) sobre la foto
   completa en un dispositivo de 2 GB; el crecimiento fallido del heap
   emscripten lanza `Aborted()` a milisegundos del warn del kill en la traza.
3. **Hipótesis #2 — re-entrancia de zxing-wasm en MAIN**: `modZxing` es UNA
   caché de módulo compartida (brújula de orientación + rescate); dos decodes
   solapados entran al mismo módulo vivo → `abort()` (estado global que se pisa).
4. **Hipótesis #3 — OpenCV.js dentro de `detection-worker.js`**: su
   `self.onmessage` (warp hasta 4032) es el único handler llamado
   literalmente `onmessage` que ejecuta wasm — si su heap aborta, el frame
   del stack es `e.onmessage` (minificado).
5. El «colgado» del QR en sí: con CPU 6× el ladder completo (2048² + rescate)
   excede 8 s+1.5 s → el hard-kill dispara y resuelve honesto (`fin:"vencido"`);
   el estado contaminado queda en los WASM de main, no en el worker.

Mitigación implementada (barata, sin tocar resultados/protocolo): guard de
re-entrancia en el `onmessage` del worker FUENTE — máximo 1 cadena viva; el
mensaje extra se responde «ocupado» con una `RespuestaCapa0` legal
(`corrio:true, payload:null, presupuestoVencido:true, fin:"vencido", ms:0`) y
se descarta (sin cola). En el flujo de cámara actual (secuencial) es un no-op;
blinda el escenario pool≥2 donde dos cadenas pisarían el guard de barrido
global de `qr-pixeles.ts` y duplicarían los picos de memoria. El cableado
completo quedó en try/catch con respuesta de fallo controlado. NO se tocó
zxing-wasm ni OpenCV (wasm ajeno a este bundle — solo instrumentación).

## 4 · Plan de réplica en dispositivo (qué mirar en la traza)

1. Filtrar consola por `[e14]`: `accion=crear` → `qr-capa0-worker tier=… ms=…
   fin=… fases=…` (dev) y, si cuelga, `accion=hard-kill kills=1 …` — el
   `kills=N` confirma el respawn perezoso.
2. `window.__e14Telemetria.qrWorkerHardKills` desde consola: >0 = cuelgues sin abrir el buffer obs.
3. Ante `Aborted()`: capturar el stack COMPLETO y ubicar el frame —
   `detection-worker.js` → hipótesis #3; frames de promesa en main con
   `zxing` → #1/#2. Correlacionar el timestamp con el `hard-kill kills=N`
   inmediatamente anterior (el rescate zxing arranca tras el kill).
4. Memoria: heap snapshot justo tras el kill (picos esperados: decode 12 MP +
   zxing 2048²/4096²). En obs: eventos `LoggerWarn` con breadcrumbs.
5. Detección: `window.__scannerPrecision()` (ready/dead) y el cap del warp (F-DEVBENCH) para descartar la hipótesis #3.
6. IMPORTANTE: `public/scanner/capa0-qr.worker.js` queda obsoleto hasta el
   `prebuild` (regenera desde la FUENTE con el guard C4); el smoke de fresura
   lo marcará hasta entonces. NO se ejecutó el build aquí; el cliente pide el
   artefacto con `?v=5` (bump obligatorio del cache-busting, auditoría A-15).
