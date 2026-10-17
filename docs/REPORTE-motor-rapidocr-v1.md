# REPORTE — KIT e14-motor-rapidocr-v1 (PROD-2)

**Rama:** `feat/motor-rapidocr` (bifurcada de `feat/ocr-lee-original` @ `609f324` — gate §8: HEAD del PROD-1, PR #12 ABIERTO, SIN merge — regla fija) · **Base:** PR #12 aún NO mergeado al empezar · **Fecha:** 2026-10-17 (Bogotá) · **Agente:** Z.ai Code

---

## 0. Regla implementada (decisión del dueño)

> TODO el OCR del producto (escaneo, recorte de rescate, re-OCR del editor y banda del sello) pasa de `requestOcr` (Tesseract spa+eng · downscale 1600 · core) a **RapidOCR PP-OCRv4** (det 1920/max, modelos vendidos, EP wasm) — leyendo el recorte «original» según la regla del PROD-1, que queda INTACTA. Nada más cambia.

La imagen mostrada/guardada sigue siendo bw; el gate, el score, los marcadores y la matriz del informe no se tocan. **Sin fallback de motor** (pitfall §9.3): un solo motor de producción; el fallo sigue el camino controlado que ya existe (texto vacío → gate decide).

## 1. Evidencia (del kit §1 — dispositivo real + lab oficial FILTROS-1)

| Acta | motor | anclas | campos | GT | CER | conf | infer |
|---|---|---|---|---|---|---|---|
| Frankfurt P2 | Tesseract 1600 (hoy) | 7/10 | 4 | 8/14 | 60.6 % | — | 2299 ms |
| Frankfurt P2 | **RapidOCR v4** | **9/10** | **6** | **13/14** | **28.0 %** | 0.87 | 6434 ms |
| El Cairo P1 | Tesseract 1600 (hoy) | 8/10 | 5 | 10/14 | — | — | 4943 ms |
| El Cairo P1 | **RapidOCR v4** | 8/10 | 5 | **12/14** | — | **0.92** | 8573 ms |

Lab FILTROS-1: rapidocr+original **51/56** (CER 25.3 %, conf 90-91) vs tesseract-tuned 35-37/56 — gana **12/12** comparaciones foto×filtro.

**Coste honesto (aceptado por el dueño):** inferencia MÁS LENTA (+2~4 s por acta: medido en la validación headless 5.6-6.7 s de OCR vs ~2.3-4.9 s de Tesseract) y primera carga de modelos ~1.1 s — **el pre-warm al importar el bridge la paga en background ANTES de la primera captura** (verificado: los 4 fetches de modelos ocurren al cargar la app, sin capturas). Singleton compartido producción/informe: la matriz del informe sale con `carga 0` y la 2.ª captura arranca con det caliente (902 ms vs 1205 ms del primer run). Modelos + runtime YA vendidos en el repo (~44 MB locales, sin CDN — pitfall §9.4 respetado: 0 rutas nuevas a internet).

## 2. Qué cambió (6 archivos — diff vs `609f324`)

| # | Punto | Archivo | Implementación |
|---|---|---|---|
| C1 | MOVE módulo | `informe/rapidocr.ts` → `ocr/rapidocr.ts` | MOVE literal (rename 95 %, mismo código): único cambio de import `./telemetria` → `../informe/telemetria` + JSDoc de módulo compartido + **pre-warm** al final (`if (typeof window !== "undefined") void rapidOcrInit().catch(() => {})`). `matriz.ts` L15: SOLO el import path nuevo |
| C2 | 3 puntos de lectura | `scanner-core-bridge.ts` | adaptador `reconocerRapidOcr(dataUrl, onProgress?)` — mismo contrato (texto + progreso); `pipeline()`, `pipelineRecorte()` y `reconocerTexto()` pasan de `requestOcr(fotoOcr/fotoProcesada)` al adaptador con la MISMA entrada que dejó el PROD-1 |
| C3 | `ocrBanda()` | `scanner-core-bridge.ts` | banda del sello → `reconocerRapidOcr(canvas)` — un solo motor (escape hatch §5: revert puntual de C3 si el QA muestra regresión) |
| C4 | Progreso OCR | `ocr/rapidocr.ts` | `rapidOcrReconocer(rt, dataUrl, onProgress?)` — callback OPCIONAL; tras cada lote de rec (6 líneas) reporta `i/total` (0→1). El informe NO lo pasa (instrumento byte a byte) |
| C5 | Trazas + etiquetas | bridge + `telemetria.ts` + `generar.ts` + `referencia-lab.ts` | token grep-able `ocr=rapidocr conf=0.93 det=1205ms rec=4648ms` junto al `ocrIn=` del PROD-1 en AMBOS logs · `PipelineInfo.ocrMotor` («rapidocr-v4») + `ocrConf` (number|null, defaults `""`/null) · JSON del informe con `ocrMotor`/`ocrConf` (§6.4) · línea fija «MOTOR DE PRODUCCIÓN: RapidOCR PP-OCRv4…» + etiqueta «Tesseract 1600 (motor anterior)» en conclusiones · «hoy 27/56» → «motor anterior 27/56» |

`requestOcr` del core SOLO queda en `informe/motores.ts` (celda «actual» de la matriz — instrumento congelado, pitfall §9.2). Cero tuning del modelo (pitfall §9.1): det 1920/max, EP ["wasm"], lotes de 6, umbrales DB — EXACTO el código validado.

## 3. Decisiones / ADAPTACIONES documentadas (ninguna improvisada)

1. **C4 en el commit 1** (el kit sugería separarlo en el 2.º): el adaptador del §3 pasa `onProgress` desde el primer momento → para que cada commit compile, C4 viajó con C1-C3. Los commits sugeridos son orientativos; el 2.º commit quedó con las trazas + campos del informe + etiquetas (C5).
2. **Captura de conf/det/rec ANTES de la banda**: `ultimoOcrConf/Det/Rec` (vars de módulo, kit §3) se leen justo tras el OCR PRINCIPAL de cada pipeline — la banda del sello también corre RapidOCR y pisaría los valores en la traza. Token del log = siempre el OCR principal.
3. **JSON del informe es mapeo selectivo** (igual que en PROD-1): `ocrMotor`/`ocrConf` añadidos explícitamente al mapeo de `construirInforme` (kit §4.2 dice «el JSON queda auto-descripto»; en la base real el mapeo es campo a campo — §6.4 exigido y cumplido).
4. **Re-OCR del editor (reconocerTexto) NO alcanzable headless**: la rama de la fila de acciones con el botón «Texto» es la OPTIMA «transitoria, inalcanzable en REVISIÓN» (comentario de la propia UI, FASE A del kit visor-accion-score) y el auto-envío la consume inmediatamente. El cambio es un swap de 2 líneas al MISMO adaptador ya verificado en 4 flujos — veracidad del §6.5 parcial, documentada aquí (§6.7 del kit: no verificable headless → QA del dueño).
5. **`POST /api/ocr 404` en el log de dev**: el core lo emite y reintenta por su worker local — pre-existente (no introduce el kit); la celda «actual» de la matriz midió Tesseract OK en la validación.
6. **pipelineRecorte sigue sin invocar `registrarPipelineE14`** (igual que en PROD-1, base `8443ff4`/`609f324` no registra en el rescate): los campos nuevos viajan en la ÚNICA llamada existente (escaneo). No alterar el instrumento.

## 4. Validación headless (kit §6 — COMPLETA)

1. ✅ `tsc --noEmit` 0 errores · `bun run lint` 0 · `bun run build` estático (páginas 3/3).
2. ✅ **Intocables = 0 archivos**: core npm, `bun.lock`/`package.json`, `divipol.json`, `ScanView.tsx`, `store.ts`, `detection-worker.js`, modelos/vendor — 0 toques. La LÓGICA de la matriz: `git diff` de `matriz.ts` = SOLO el import path del módulo movido; 9 celdas corrieron completas (0 errores) con motores/orden/variantes intactos (`['actual','rapidocr-v4','tesseract-fullres']`).
3. ✅ Navegador (:3001, 412×850, dev log sin errores nuevos): **pre-warm visible** — `ppocr_keys.txt` + 3 ONNX fetch-ados al cargar la app, ANTES de la primera captura · **SIM óptima** `score=8.2 filtro=bw ocrIn=original ocr=rapidocr conf=0.93 det=1205ms rec=4648ms` clasif AUTO cod `710007453010102` · **SIM intermedia (as-is)** `score=7 ocrIn=original-as-is ocr=rapidocr conf=0.91` con `detect=0 proceso=0` (cero llamadas nuevas, chips intactos) · **SIM baja** `score=4.3 ocrIn=original-as-is conf=0.62` · **IMPORTAR** `ARCHIVO/file score=8.5 filtro=bw ocrIn=original ocr=rapidocr` + esquinas OK + AUTO.
4. ✅ **Informe**: 9 celdas OK (la «actual» sigue midiendo Tesseract vía core — no rompió con el MOVE) · JSON con `ocrMotor: "rapidocr-v4"`, `ocrConf: 0.9333`, `ocrInputFiltro: "original"` · TXT: línea de pipeline `filtro=bw · ocrInputFiltro=original` + conclusiones con «Tesseract 1600 (motor anterior)» + «MOTOR DE PRODUCCIÓN: RapidOCR PP-OCRv4…» + laboratorio «Tesseract (motor anterior)».
5. ✅ **RECORTE manual** sobre acta as-is: `[e14] recorte … filtro=original ocrIn=original ocr=rapidocr conf=0.91` — camino reuse (UNA sola llamada, pitfall §9.4). El caso bw (2.ª llamada) queda cubierto por el mismo patrón Promise.all verificado en escaneo/IMPORTAR.
6. ✅ **Clasificadores sobre texto RapidOCR (§6.6)**: `clasificarCabecera` AUTO en las 4 pruebas (con `cod:` completo del código 1D en óptima/intermedia/importada — el código se lee MEJOR con RapidOCR, coherente con §1 del kit), `tipoDeBanda`/`codigoUnicoE14`/paginación sin regresión. **Sin regresión → no aplica el STOP**; no se ajustó ninguna regex (pitfall §9.7).
7. Singleton compartido (pitfall §9.6): matriz con `carga 0` (vs descarga inicial), 2.ª captura con det caliente, 0 re-descargas de modelos tras N capturas. `resetInitsMatriz` no toca `rtSingleton` (verificado en el 2.º informe).

## 5. Presupuesto y fallos (§5 del kit — comportamiento implementado)

- TIMEOUT_MS 15 s INTACTO: el pipeline total medido headless 7.0-7.7 s (OCR 5.6-6.7 s) — margen suficiente; si vence: RECHAZADA ILEGIBLE controlada (igual que hoy).
- `rapidOcrReconocer` falla → SIN fallback de motor: el texto vacío sigue el camino controlado del gate.
- Banda: misma lógica de 2.ª pasada sobre la bw mostrada; escape hatch = revert puntual de C3 (documentado, no improvisado).
- Score: sigue al reconocimiento (8.2/8.5 medidos — puede moverse ±0.x, criterios intactos).

## 6. QA del dueño (§7 del kit — protocolo)

1. Capturar El Cairo P1 y Frankfurt P2; esperado: Frankfurt anclas 7→**9**, campos 3→**6**, GT 8→**13**, CER 60→**28**; El Cairo GT 10→**12**, conf ~0.92. ANALIZANDO ~2-4 s más larga — esperado.
2. Primera captura tras abrir el app no debe sentir la carga (pre-warm); si se siente, anotar el tiempo.
3. Verificar banda del sello (kit/mesa en la píldora) y código 1D (`cod:` en la traza). REVISIÓN/ENVIADA siguen mostrando bw; «Imagen» descarga bw.
4. Enviar los 2 informes TXT/JSON — el análisis antes/después se hace sobre `celdas` + `ocrMotor/ocrConf/ocrInputFiltro` del pipeline.
