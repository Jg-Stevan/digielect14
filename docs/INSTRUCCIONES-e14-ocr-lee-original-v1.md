# KIT e14-ocr-lee-original-v1 (PROD-1) — El OCR lee el recorte SIN filtro; la imagen mostrada sigue siendo bw

**Task ID:** PROD-1 · **Repo:** Jg-Stevan/digielect14 · **Rama nueva:** `feat/ocr-lee-original`
**Base:** `feat/informe-telemetria-ocr` (HEAD `8443ff4`) — ver §8 (gate de dependencia)
**Fecha:** 2026-10-17 · **Idioma del kit:** español

---

## 0. Decisión del dueño (literal)

> «después del recorte automático se lee el OCR con (filtro original) y se termina
> mostrando la imagen con filtro bw, lo demás así.»

**Traducción a una regla única de producto:**

> **TODO el OCR del producto lee el RECORTE SIN filtro (`PageFilter "original"` — el
> crudo del warp). La imagen que se MUESTRA y se GUARDA sigue con el filtro del acta
> (bw en el flujo normal). Nada más cambia.**

El bw NO se elimina del producto: deja de ser la ENTRADA del OCR y pasa a ser
exclusivamente la imagen de PRESENTACIÓN (visor de REVISIÓN/ENVIADA, descarga
«Imagen», acta almacenada). El motor OCR actual (Tesseract spa+eng OEM1, downscale
1600, worker caliente del core) queda EXACTAMENTE igual — no se toca el core.

---

## 1. Evidencia que respalda la decisión (dispositivo real, motor «actual»)

De los 2 informes de telemetría generados por el propio app en el teléfono del dueño
(`informe-e14-20261016-200747.json` El Cairo P1 · `informe-e14-20261016-200850.json`
Frankfurt P2), celdas del motor «actual» (el de producción):

| Acta | variante | chars | anclas | campos | GT | CER | totalMs |
|---|---|---|---|---|---|---|---|
| El Cairo P1 | recorte-**bw** (hoy) | 660 | **6**/10 | 5 | 9/14 | — | 3989 |
| El Cairo P1 | recorte-**raw** | 650 | **8**/10 | 5 | **10/14** | — | 4943 |
| Frankfurt P2 | recorte-**bw** (hoy) | 523 | **5**/10 | 3 | 7/14 | 54.1 % | 3779 |
| Frankfurt P2 | recorte-**raw** | 260 | **7**/10 | 4 | **8/14** | 60.6 % | 2299 |

Lectura honesta (esto va en el REPORTE):

1. **Anclas/campos/GT ganan 2/2 actas** con raw: +2 anclas en cada una, +1 campo y
   +1 GT en Frankfurt. Eso es lo que alimenta `clasificarCabecera`, el consenso y
   el gate — no el CER.
2. **En impresas con sello (Frankfurt) el texto crudo se COLAPSA a 260 chars** (la
   mitad). El CER empeora (60.6 vs 54.1). Riesgo conocido y aceptado por el dueño:
   las funciones que dependen del TEXTO COMPLETO (editor texto-OCR, palabras de
   sección) verán menos texto en impresas.
3. **NO hay regresión en secciones**: en Frankfurt P2 «FIRMA»/«SUMA TOTAL» ya fallan
   HOY con bw (523 chars tampoco las contienen) → `faltaSeccionInferior` no empeora;
   el techo 7.9 ya estaba.
4. El tiempo es neutro-ish (Cairo +0.9 s, Frankfurt −1.5 s). El coste real nuevo es
   el SEGUNDO warp (§4.1): ~0.6–1.3 s dentro de REALZANDO — bajo el TIMEOUT_MS de
   15 s, cubierto por la misma rampa.
5. Referencia de laboratorio embebida (la misma del SPEC): RapidOCR raw es muy
   superior (9/10 anclas, CER 28 %, GT 13/14) — camino futuro, FUERA de este kit.

QA previa del dueño (4 fotos de campo del digitalizador E-14, sistema de
comparativa silenciosa): raw ganó 4/4 en anclas vs bw (Δ+1~3) — coherente con la
tabla de arriba.

---

## 2. Alcance EXACTO

### CAMBIA (solo esto)

| # | Punto | Hoy | Queda |
|---|---|---|---|
| C1 | `pipeline()` paso 5 (escaneo CAMARA/ARCHIVO): `requestOcr(fotoProcesada)` L776 | lee la imagen **bw** | lee el recorte **"original"** (nueva variante `fotoOcr`, §4.1) |
| C2 | `pipelineRecorte()` paso 3 (rescate manual): `requestOcr(fotoProcesada)` L1149 | lee la variante del acta (bw por defecto) | lee el recorte **"original"** con `{manual:true}` (§4.2) |
| C3 | `reconocerTexto()` (F-OCR del editor) L1413 | `requestOcr(acta.fotoProcesada)` | recorte **"original"** si hay `fotoOriginal`+`quadDetectado`; fallback `fotoProcesada` (§4.3) |
| C4 | Trazas: log de auditoría + `registrarPipelineE14` | no distinguen la entrada del OCR | token `ocrIn=` + campo `ocrInputFiltro` (§4.4) |
| C5 | `generar.ts` conclusión «¿ORIGINAL O FILTROS?» | dice «bw (producción hoy)» | «bw (imagen mostrada)» — veracidad; la LÓGICA de la conclusión queda intacta |

### NO CAMBIA (lista dura — cada ítem verificado en el código)

- `fotoProcesada`, `filtroActa="bw"`, `Acta.filtro` — la imagen mostrada/guardada y
  su metadato siguen siendo bw (visor REVISIÓN/ENVIADA, descarga «Imagen», editor).
- **`ocrBanda()`** (banda dirigida del sello): sigue recortando de `fotoProcesada`
  (bw) con su inversión ×2 — el sello es blanco-sobre-negro de alto contraste y hoy
  funciona; moverlo NO está en el alcance.
- Análisis VISUALES sobre la procesada: `esquinasDeActa`, `verificarCompletitud`,
  `procesadaVaciaDataUrl`, `calidadDeActa`, marcadores/votos, secciones
  (`faltaSeccionInferior` como función) — todos consumen la bw como hoy.
- Gate §4 / score / `ocrTextIsValid` / `contEfectivoDe`: misma lógica; SOLO cambia el
  texto que entra (el score sigue al reconocimiento — puede moverse ±0.x, es esperado).
- **Rama `sinRecorte` (SIM)**: `fotoProcesada = fotoOriginal` y filtro "original" —
  su OCR YA lee la original: `fotoOcr = fotoOriginal`, cero trabajo extra, chips SIM
  8.2/7.0/4.3 intactos por construcción.
- **Matriz del informe (9 celdas)**, `motores.ts`, `rapidocr.ts`, `analisis-texto.ts`:
  intactos — es el INSTRUMENTO de medición, debe seguir comparable entre versiones.
- `@jg-stevan/scanner-core` (npm), `detection-worker.js`, modelos RapidOCR, divipol,
  `ScanView.tsx`, `store.ts`, UI, estilos: **0 archivos**.
- El editor de filtros (cambiarFiltro/reprocesar): sigue reconstruyendo SOLO la
  imagen mostrada con el filtro elegido.

---

## 3. La variante de OCR: qué es exactamente

`processImage(fotoOriginal, quad, "original", rotacion)` = **warp INTER_CUBIC sin
ningún realce** (passthrough post-warp — así lo usa ya la matriz del informe,
`matriz.ts` L119 «recorte-raw = "original" (el crudo del warp)»). Es EXACTAMENTE la
misma geometría que la bw (mismo warp, mismo `rotacion` — convención POST-warp de
F4/D37), solo cambia el filtro final. Por eso las proporciones de banda/secciones
siguen siendo válidas sobre cualquiera de las dos.

**Prohibido** obtener la variante de OCR por otra vía (canvas propio, re-warp
manual, foto completa sin recortar): la única fuente admitida es `processImage` del
core con `"original"` (o la `fotoOriginal` tal cual en la rama as-is).

---

## 4. Especificación por archivo

### 4.1 `src/lib/e14/scanner-core-bridge.ts` — `pipeline()` (escaneo)

Paso 3 (L702-731, rama normal — NO la rama `sinRecorte`): hoy una sola llamada.
Construir DOS variantes bajo la **MISMA** `conRampa` (misma semántica
RECORTANDO .2→.6 / REALZANDO .4→1; subir `msEstimados` de 1400 a ~2200 para cubrir
el segundo warp — el core serializa en su worker):

```ts
const [resultado, resultadoOcr] = await conRampa(
  Promise.all([
    processImage(fotoOriginal, quad, "bw"),              // MOSTRAR/GUARDAR (hoy)
    processImage(fotoOriginal, quad, "original"),        // LEER (PROD-1)
  ]),
  2200,
  (f) => f < 0.55
    ? { etapa: "RECORTANDO", progreso: 0.2 + (f / 0.55) * 0.4 }
    : { etapa: "REALZANDO", progreso: 0.4 + ((f - 0.55) / 0.45) * 0.6 },
  emitir,
);
fotoProcesada = resultado.processed;
filtroActa = "bw";
motor = resultado.precision?.engine ?? "canvas";
// PROD-1 — entrada del OCR, con fallback que JAMÁS rompe el pipeline:
let fotoOcr = fotoProcesada;
let ocrIn: "original" | "bw-fallback" = "original";
try {
  if (resultadoOcr?.processed) fotoOcr = resultadoOcr.processed;
  else ocrIn = "bw-fallback";
} catch {
  ocrIn = "bw-fallback"; // fotoOcr queda = fotoProcesada (comportamiento de hoy)
}
```

- Rama `sinRecorte` (L707-709): `fotoOcr = fotoOriginal; ocrIn = "original"` — la
  entrada ya era la original, cero llamadas nuevas.
- Paso 5 (L776): `requestOcr(fotoOcr, …)` — mismo progreso, mismo resto del flujo
  (banda L786-790 SEGUIRA llendo sobre `fotoProcesada` — ver NO CAMBIA).
- El `try/catch` envuelve solo la extracción de la variante (la llamada va dentro
  del `Promise.all`; si `processImage("original")` rechaza, `Promise.all` rechaza →
  **cuidado**: para que el fallback sea real, usa
  `processImage(...,"original").catch(() => null)` dentro del `Promise.all` y
  decida con el resultado null. El pipeline NUNCA muere por la variante nueva.

### 4.2 `src/lib/e14/scanner-core-bridge.ts` — `pipelineRecorte()` (rescate manual)

Mismo patrón en L1116-1131 con `{manual:true}` en ambas llamadas y la optimización
de no duplicar warp:

```ts
const filtro: PageFilter = acta.filtro ?? "bw";
// si el acta YA está en "original", la procesada ES la entrada del OCR:
const pBw = processImage(fotoOriginal, quad, filtro, rotacion, { manual: true });
const pOcr = filtro === "original" ? pBw
  : processImage(fotoOriginal, quad, "original", rotacion, { manual: true }).catch(() => null);
const [resultado, resultadoOcr] = await conRampa(Promise.all([pBw, pOcr]), 2200, rampa, emitir);
```

- Paso 3 (L1149): `requestOcr(fotoOcr, …)`; fallback idéntico (`bw-fallback`).
- Banda (L1156-1159): intacta sobre `fotoProcesada`.

### 4.3 `src/lib/e14/scanner-core-bridge.ts` — `reconocerTexto()` (L1413-1419)

Coherencia: el re-OCR manual del editor aplica la MISMA regla del producto.

```ts
if (acta.fotoOriginal && acta.quadDetectado) {
  try {
    const r = await processImage(acta.fotoOriginal, acta.quadDetectado,
                                 "original", acta.rotation ?? 0);
    return requestOcr(r.processed);
  } catch { /* cae al fallback de abajo */ }
}
return requestOcr(fotoProcesada); // comportamiento de hoy (fallback)
```

Documentar en el JSDoc que el texto del editor puede diferir del histórico (es la
regla nueva, no un bug).

### 4.4 Trazas (C4/C5)

- Log de auditoría del pipeline (L930-944): añadir token `ocrIn=${ocrIn}`
  (`original` | `original-as-is` | `bw-fallback`) — grep-able en consola/dev.log.
- `informe/telemetria.ts`: `PipelineInfo` gana `ocrInputFiltro: string` (default
  `""` en L134-136); `registrarPipelineE14` lo recibe desde ambos pipelines.
- `informe/generar.ts`: (a) el JSON ya vuelca el registro del pipeline — el campo
  nuevo sale solo; (b) en la línea/section TXT del pipeline añadir
  `ocrInputFiltro=…`; (c) conclusión L182: reemplazar el literal
  «bw (producción hoy)» por «bw (imagen mostrada)» — LÓGICA intacta.

---

## 5. Casos borde y presupuesto

| Caso | Comportamiento exigido |
|---|---|
| `processImage("original")` falla (decode/warp) | OCR lee `fotoProcesada` + `ocrIn=bw-fallback` — el pipeline JAMÁS rechaza por la variante nueva |
| SIM (`sinRecorte`, assets b/n del dueño) | `fotoOcr = fotoOriginal`, sin llamadas nuevas — chips 8.2/7.0/4.3 intactos |
| Recorte manual de un acta ya en filtro "original" | UNA sola llamada (reuse), `ocrIn=original` |
| Timeout 15 s | Sin cambio: el coste añadido es un warp (~0.6–1.3 s) dentro de REALZANDO, cubierto por la rampa |
| Acta ENVIADA / historial viejo | No se reprocesa nada retroactivo — solo capturas/recortes nuevos |
| Score | Puede moverse ±0.x (sigue al reconocimiento). Criterios del gate INTACTOS |
| Editor texto-OCR / secciones en impresas | Menos chars con raw es ESPERADO (§1.2) — documentar, no «arreglar» |

---

## 6. Validación del agente (headless, antes del PR)

1. `bun run lint` 0 errores · `tsc` 0 · build estático 3/3.
2. **Intocables = 0 archivos**: `packages/` (core npm), `bun.lock`/`package.json`
   (sin deps nuevas), `public/divipol.json`, `ScanView.tsx`, `store.ts`,
   `detection-worker.js`, modelos/vendor.
3. Dev `:3001` sin errores de consola: **SIM** — chips 8.2/7.0/4.3 intactos y log
   con `ocrIn=original-as-is` (o el token que se defina para as-is); **IMPORTAR**
   (ARCHIVO, sinRecorte=false) — log `ocrIn=original`, el acta nace con
   `filtro=bw`, REVISIÓN muestra la imagen bw y el log de auditoría conserva
   `filtro=bw` junto al nuevo `ocrIn=original`.
4. El informe de telemetría sigue generándose (matriz 9 celdas + descarga) y el
   JSON incluye `ocrInputFiltro`.
5. RECORTE manual sobre un acta importada: re-procesa, `ocrIn=original` en el log
   (segunda llamada), y si se cambia el filtro del acta a "original" → UNA sola
   llamada.
6. Nada de esto es verificable headless en su faz OCR real (necesita teléfono) —
   queda para el QA del dueño (§7), MISMA política de los kits anteriores.

---

## 7. QA del dueño en dispositivo (protocolo)

1. Capturar de nuevo **El Cairo P1** y **Frankfurt P2** en condiciones parecidas a
   los informes base (ya guardados).
2. Esperado con motor actual (de los informes base): anclas 6→8 (Cairo) y 5→7
   (Frankfurt); campos 5→5 y 3→4; GT 9→10 y 7→8. Menos chars en Frankfurt (≈260)
   es el comportamiento nuevo esperado, NO un defecto.
3. REVISIÓN/ENVIADA deben seguir mostrando la imagen **bw**; «Imagen» descarga el
   JPG bw; el editor sigue ofreciendo filtros.
4. Enviar los 2 informes TXT/JSON nuevos — el análisis antes/después se hace sobre
   `celdas[actual/recorte-*]` + el campo `ocrInputFiltro` del pipeline.

---

## 8. Rama, base y entregables

- **Gate de dependencia (§1 del contrato de kits):** esta rama toca la MISMA zona
  de `scanner-core-bridge.ts` que el kit informe-telemetria-ocr (el bloque
  `registrarPipelineE14` junto al log de auditoría). Base obligatoria:
  **`feat/informe-telemetria-ocr` @ `8443ff4`**. Si al empezar el PR del informe YA
  está mergeado a main, base = main actualizado. Si sigue abierto, bifurcar de su
  HEAD y dejarlo anotado en el REPORTE (el PR de PROD-1 se audita después del del
  informe). NO se mergea nada por cuenta propia (regla fija).
- Rama: `feat/ocr-lee-original` · 1 PR → main **SIN merge** (espera auditoría).
- Commits sugeridos: (1) feat C1-C3, (2) feat trazas C4-C5 + docs.
- Docs: `docs/INSTRUCCIONES-e14-ocr-lee-original-v1.md` (este plan, verbatim),
  `docs/REPORTE-ocr-lee-original-v1.md` (nuevo, con §1 evidencia y decisiones),
  `docs/worklog.md` (entrada append-only), `AGENTS.md` (registro del kit).
- Rollback: revert del PR — sin migraciones, sin datos, sin core.

---

## 9. Pitfalls (lista dura)

1. **NO tocar `@jg-stevan/scanner-core`** — la variante sale de `processImage` del
   core tal cual está publicado.
2. **NO mover `ocrBanda`** a la original — sigue sobre `fotoProcesada` (decisión
   documentada; se puede cambiar DESPUÉS con evidencia del sello).
3. **NO tocar la matriz de 9 celdas** ni `motores.ts`/`rapidocr.ts` — el instrumento
   de medición queda congelado para comparar antes/después.
4. **NO duplicar el warp** cuando el filtro del acta ya es "original" (recorte/as-is).
5. **Rotación**: mismo argumento `rotacion` (convención POST-warp) en ambas llamadas
   — si se hornea distinto, la geometría de banda/secciones se rompe.
6. El fallback bw es OBLIGATORIO — la variante nueva jamás puede rechazar un acta
   que hoy se procesa bien.
7. El texto de secciones/FIRMA puede empeorar en impresas — ES la decisión del
   dueño (§1.3: hoy ya falla con bw); NO «compensar» con trucos.
8. `filtro` en el acta sigue describiendo la IMAGEN (bw) — no confundir con la
   entrada del OCR (campo nuevo `ocrInputFiltro`).
9. Todo en español, commits limpios, sin binarios nuevos, worklog append-only.
