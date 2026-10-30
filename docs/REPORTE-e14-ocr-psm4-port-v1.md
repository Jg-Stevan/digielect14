# REPORTE — e14-ocr-psm4-port-v1

**Puerto de velocidad desde `supervision-e14` @ `a249518`** («feat/tesseract-spa-best-v1»
— el commit que el dueño midió con los MEJORES tiempos de OCR). Pregunta de origen:
«ese commit es el ideal — necesito pasar esa rapidez a este proyecto». Diagnóstico
comparativo lado a lado de los dos motores Tesseract (mismo linaje, caminos distintos).

## Diagnóstico — qué hacía el ideal que aquí no se hacía

| Aspecto | supervision-e14 @ a249518 (rápido) | digielect14 antes de este kit |
|---|---|---|
| PSM | **4 — SINGLE_COLUMN** (`setParameters` tras crear worker) | default (PSM 3) — cero `setParameters` en src/lib |
| corePath | DIRECTORIO `/vendor/tesseract` → la lib elige simd/lstm | archivo fijo simd-lstm ⇒ en no-SIMD el intento 1 falla SIEMPRE |
| cores vendidos | simd-lstm + **lstm (no-SIMD)** | solo simd-lstm |
| modelo | spa tessdata_best (13 570 187 B descomprimido) | IGUAL (mismo tamaño exacto — sin delta) |
| OEM / gzip | LSTM_ONLY / gzip true | IGUAL |
| precalentamiento | init ≤20 s + precalor masiva | `tessPrecalentar()` en ScanView — IGUAL cobertura |
| arquitectura | Tesseract = motor primario (líneas RapidOCR) | cascada K3/GO-B: Tess intento 1 → GATE → RapidOCR (más nueva, SE CONSERVA) |

Evidencia del benchmark citada por el ideal (results/metrics.json, 9 motores × 6 actas):
**spa-best + psm 4 = 94,4 % dígitos impresos · 2,2 s/pág · RAM pico ~67 MB · descarga 13,5 MB**
(«psm 6/3 cayeron menos»). Traducción a esta cascada: PSM 4 ⇒ más actas resueltas por el
intento 1 (gate-AUTO) ⇒ menos actas pagando el escalonado completo (1280→1920+ROI).
Y el fallback no-SIMD devuelve el camino rápido en los dispositivos de gama baja sin SIMD
(hoy allí el intento 1 muere siempre al cargar el wasm simd).

## Cambios (quirúrgicos — negocio, cascada y presupuestos INTACTOS)

1. **`src/lib/e14/ocr/tesseract.ts`** — `crearWorker()`: (a) `await w.setParameters({
   tessedit_pageseg_mode: PSM.SINGLE_COLUMN })` tras `createWorker` (misma línea que
   `tesseract-ocr.ts` del repo origen); (b) `corePath` apunta al DIRECTORIO
   `/vendor/tesseract` (no al archivo simd fijo) — la lib sonda SIMD y elige.
   Interface `TessWorkerMin` +`setParameters`. Header del kit actualizado.
2. **`public/vendor/tesseract/tesseract-core-lstm.{wasm,wasm.js}`** — NUEVOS, byte a
   byte de `tesseract.js-core@5.1.1` (2 859 424 + 3 938 277 B — los mismos que vende el
   ideal; el simd vendido ya era idéntico al paquete, md5 verificado).
3. NADA más: sin flags nuevos (kill-switch `ocrCascada` intacto), sin tocar
   `ocr-cascada.ts` / `scanner-core-bridge.ts` / presupuestos / GATE / SIM.

## Gates

`bunx tsc --noEmit` = 0 · `bun run lint` = 0/0 · `bun run test` = vitest **239/239** ·
`bunx next build` = OK (3/3 estático).

## Cómo probar

1. Escaneo normal → consola: `tess-best intento1 ok conf=…` con más actas cerrando en
   `intento1` (traza `ocr-cascada … gate1=AUTO elegido=tess`) — SIN cambio de trazas ni
   contratos (mismo formato D51).
2. Dispositivo/gama baja sin SIMD: el intento 1 ahora SÍ arranca (antes caía directo a
   RapidOCR 1280). Verificación DOM: `WebAssembly.validate` simd falla ⇒ worker carga
   `tesseract-core-lstm.wasm.js` (red 200 en ese archivo).
3. Kill-switch byte-idéntico al histórico: `localStorage.setItem("e14-flags-overrides",
   '{"ocrCascada": false}')` → escalonado puro, cero Tess.

## Pendiente / límites honestos

- El PSM 4 es la config del benchmark del repo origen sobre las fotos del banco — la
  tasa gate-AUTO local (con las fotos/filtros de ESTE pipeline) se confirma en campo con
  el rastreo §9 del PanelDev; no cambia criterios ni scores: si el gate no cierra, el
  escalonado sigue igual que siempre.
- La creación del worker ahora puede cargar el core lstm (~6,8 MB) en no-SIMD — el SW
  ya cachea /vendor/tesseract en MOTOR_CACHE (kit tessbest), aplica igual.
- El dueño mantiene supervision-e14 @ a249518 como línea base de rendimiento; este kit
  alinea el intento 1 con esa config SIN transplantar la arquitectura vieja.
