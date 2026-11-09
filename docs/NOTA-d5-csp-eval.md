# NOTA D5 — CSP EvalError («unsafe-eval is not an allowed source» + net::ERR_ACCESS_DENIED)

KIT e14-remediacion-movil-v1 (D5.4 — SOLO investigación, sin build ni cambio de CSP).

CSP real (`public/_headers:26`): `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`.
`'wasm-unsafe-eval'` cubre **solo** WebAssembly.compile/instantiate; cualquier `eval()`
/ `new Function()` de JS revienta con el EvalError reportado.

## Candidatos (grep estático `new Function\(|\beval\(`)

1. `packages/scanner-core/src/core/__tests__/parity-worker-filters.test.ts:257` —
   `const factory = new Function(...)` para evaluar el código espejado del worker
   en sandbox. **Test-only (vitest): nunca se bundula** ⇒ descartado.
2. Grep con glob `*.min.js` sobre `src`, `public`, `packages/scanner-core/src`:
   **0 coincidencias**; `public/vendor/opencv-4.5.5.js` (2.4 KB, puente, no es el
   core) y `public/scanner/*.js` limpios. Otros patrones string-eval: 0.

## Vacío conocido (limitación de este checkout)

El vendor que SÍ corre en runtime se **genera**, no está versionado:
`bun run preparar` → `scripts/sincronizar-vendor.mjs` copia de node_modules
`ort-wasm-simd-threaded.mjs` → `/vendor/onnxruntime/`, `tesseract.js/dist/worker.min.js`
y `tesseract-core-*-lstm.wasm.js` (wasm embebido base64) → `/vendor/tesseract/`.
En este clone node_modules es parcial (sin paquetes runtime) ⇒ **grep pendiente**
sobre esos archivos y sobre chunks de Next (`next build`); candidatos: glue
emscripten de ORT, `heic2any`/`jspdf` (bundled en src).

## Hipótesis del disparador

- **H1 (fuerte): vendor dentro de un worker.** El EvalError no muestra stack de la
  app ⇒ algo dentro de un worker o vendor evalúa una cadena. El
  `net::ERR_ACCESS_DENIED` acompañante encaja con una carga de script/worker desde
  `blob:`/`data:` denegada por la misma CSP (`worker-src 'self' blob:`,
  `connect-src 'self' data: blob:` — sin `data:` en `script-src`).
- **H2: chunk de DEV.** El error se vio en dev (`next dev`), cuyos chunks no están
  en el árbol. Reproducir con el export estático (`out/` + `_headers` de CF).
- **H3 (descartada): source-map.** Un mapa no evalúa código; solo explica que el
  stack llegue minificado. No puede producir el EvalError.

## Qué hacer en la próxima serie para aislarlo

1. Listener de arranque (main y DENTRO de cada worker) con filtro
   `e.error instanceof EvalError || /unsafe-eval/.test(e.message)` → `appendEvento`
   (stack truncado 2000, scrub §3) para tener archivo+línea del disparador real.
2. Añadir temporalmente `report-to`/`report-uri` a la CSP (o publicar la misma
   política como `Content-Security-Policy-Report-Only`) y ver la fuente exacta.
3. Con node_modules completo: `rg -c "new Function\(|\beval\("` sobre los archivos
   del paso «Vacío conocido» + chunks de Next, y cerrar la lista de culpables.
4. Diferenciar DEV vs PROD en el repro (H2) antes de tocar la CSP: si solo pasa
   en dev, no endurecer nada en `_headers`.
