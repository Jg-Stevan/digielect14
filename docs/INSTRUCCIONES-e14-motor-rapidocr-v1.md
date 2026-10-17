# KIT e14-motor-rapidocr-v1 (PROD-2) — RapidOCR PP-OCRv4 como motor de producción

**Task ID:** PROD-2 · **Repo:** Jg-Stevan/digielect14 · **Rama nueva:** `feat/motor-rapidocr`
**Base:** `feat/ocr-lee-original` (HEAD del PROD-1) — ver §8 (gate de dependencia)
**Fecha:** 2026-10-17 · **Idioma del kit:** español

---

## 0. Decisión del dueño (literal)

> «sip deja el motor de RapidOCR, es el mas bueno no?»

**Traducción a una regla única de producto:**

> **TODO el OCR del producto (escaneo, recorte de rescate, re-OCR del editor y banda
> del sello) pasa de `requestOcr` (Tesseract spa+eng · downscale 1600 · core) a
> RapidOCR PP-OCRv4 (det 1920/max, modelos vendidos, EP wasm) — leyendo el recorte
> «original» según la regla del PROD-1, que queda INTACTA. Nada más cambia.**

La imagen mostrada/guardada sigue siendo bw; el gate, el score, los marcadores y la
matriz del informe no se tocan.

---

## 1. Evidencia (dispositivo real + lab oficial FILTROS-1)

Celdas de los informes base del dispositivo (mismo acta, variante recorte-raw):

| Acta | motor | anclas | campos | GT | CER | conf | infer |
|---|---|---|---|---|---|---|---|
| Frankfurt P2 | Tesseract 1600 (hoy) | 7/10 | 4 | 8/14 | 60.6 % | — | 2299 ms |
| Frankfurt P2 | **RapidOCR v4** | **9/10** | **6** | **13/14** | **28.0 %** | 0.87 | 6434 ms |
| El Cairo P1 | Tesseract 1600 (hoy) | 8/10 | 5 | 10/14 | — | — | 4943 ms |
| El Cairo P1 | **RapidOCR v4** | 8/10 | 5 | **12/14** | — | **0.92** | 8573 ms |

- Lab oficial FILTROS-1 (4 fotos del digitalizador, 3 runs): rapidocr+original
  **51/56** (CER 25.3 %, líneas 88/104, num 19/20, conf 90-91) vs tesseract-tuned
  35-37/56 (CER 41-44 %) — gana **12/12** comparaciones foto×filtro.
- Referencia de laboratorio embebida: RapidOCR **49/56** · tuned 39/56 · motor
  actual 27/56.
- Con RapidOCR, en Frankfurt los campos pasan 3→6 (zona/puesto/mesa/kit/código1D/
  página completos) y el código 1D se lee bien — el consenso y la identificación
  del acta mejoran de raíz.

**Coste honesto (va en el REPORTE):** la inferencia es MÁS LENTA (+2~4 s por acta:
6.4-8.6 s vs 2.3-4.9 s medidos) y la primera carga de modelos cuesta ~1.1 s
(singleton de sesión; §4-C5 lo pre-calienta en background). A cambio: anclas, GT,
CER, campos y conf superiores en TODA la data. Modelos + runtime YA vendidos en el
repo (~44 MB locales, sin CDN — funciona en campo sin señal).

---

## 2. Alcance EXACTO

### CAMBIA (solo esto)

| # | Punto | Hoy | Queda |
|---|---|---|---|
| C1 | Módulo RapidOCR | solo del informe (`src/lib/e14/informe/rapidocr.ts`) | módulo COMPARTIDO `src/lib/e14/ocr/rapidocr.ts` (MOVE — mismo código) |
| C2 | 3 puntos de lectura (`pipeline()` L776, `pipelineRecorte()` L1149, `reconocerTexto()` L1418) | `requestOcr(fotoOcr/fotoProcesada)` | adaptador `reconocerRapidOcr(...)` — MISMO contrato (texto), MISMA entrada (fotoOcr del PROD-1) |
| C3 | `ocrBanda()` L489 (banda del sello, 2.ª pasada) | `requestOcr(canvas invertido)` | `reconocerRapidOcr(canvas)` — un solo motor; escape hatch §5 |
| C4 | Progreso de la etapa OCR | progreso real de requestOcr 0→1 | progreso real de rec por lotes (`rapidOcrReconocer` gana `onProgress?` opcional) |
| C5 | Pre-warm + trazas + etiquetas | carga perezosa del informe; sin conf en trazas | `rapidOcrInit()` en background al cargar el módulo; `ocrMotor`/`ocrConf` en el registro; etiquetas de veracidad en `generar.ts`/`referencia-lab.ts` |

### NO CAMBIA (lista dura)

- **PROD-1 completo**: entrada = recorte «original» (`fotoOcr`), fallback
  `bw-fallback` de IMAGEN, token `ocrIn=`, campo `ocrInputFiltro` — todo sigue.
- **Matriz del informe: 9 celdas CONGELADAS** (mismos motores «actual» /
  «tesseract-fullres» / «rapidocr-v4», mismas variantes, mismo orden). La celda
  «actual» SIGUE midiendo Tesseract 1600 vía `requestOcr` del core — es el
  instrumento que permite comparar antes/después del swap. Solo cambian ETIQUETAS
  de veracidad (§4-C5), nunca la lógica.
- **Core npm** (`@jg-stevan/scanner-core`): 0 cambios; su worker caliente queda
  como está (el instrumento lo usa).
- Gate §4 / score / `ocrTextIsValid` / marcadores / secciones / completitud /
  calidad: misma lógica (consumen el TEXTO — ahora mejor; NO compensar nada).
- SIM (`sinRecorte`): el OCR pasa a RapidOCR sobre `fotoOriginal`; los chips
  8.2/7.0/4.3 quedan intactos (scoreSimulado).
- Foto de entrada: el RECORTE (regla del dueño). NOTA honesta: la celda
  «rapidocr/foto-completa» dio 10/10 anclas en Frankfurt — queda como observación
  del instrumento; NO se cambia la regla en este kit.
- `ScanView.tsx`, `store.ts`, divipol, editor de filtros, detección (quad),
  detection-worker.js: 0 archivos.
- Config del modelo: det_limit 1920/max, executionProviders ["wasm"] (determinista,
  WebGPU solo se anota con `notaWebgpu`), lotes cls/rec de 6, umbrales DB —
  EXACTAMENTE lo validado; cero tuning en este kit.

---

## 3. El adaptador de producción

```ts
// src/lib/e14/scanner-core-bridge.ts (junto a los helpers §4.4)
import { rapidOcrInit, rapidOcrReconocer } from "./ocr/rapidocr";

/** Motor de producción (PROD-2): RapidOCR PP-OCRv4 sobre el recorte original.
 *  Mismo contrato que requestOcr: texto + progreso 0→1. Sin fallback de motor:
 *  el fallo sigue el mismo camino controlado de hoy (§5). */
async function reconocerRapidOcr(
  dataUrl: string,
  onProgress?: (p: number) => void,
): Promise<string> {
  const rt = await rapidOcrInit();               // singleton de sesión (pre-warm)
  const r = await rapidOcrReconocer(rt, dataUrl, onProgress);
  ultimoOcrConf = r.confMedia;                    // para la traza (§4-C5)
  return r.texto;
}
```

- `rapidocr.ts` ya tiene singleton propio (`rtSingleton`) → producción e informe
  COMPARTEN runtime: la matriz del informe sale con `cargaMs≈0` (beneficio gratis).
- Resultado rico (`confMedia`, `msDet`, `msRec`, `nBoxes`) → trazas sin coste.

---

## 4. Especificación por archivo

### 4.1 `src/lib/e14/informe/rapidocr.ts` → `src/lib/e14/ocr/rapidocr.ts` (C1 — MOVE)

- Código idéntico; ÚNICO ajuste de import: `./telemetria` → `../informe/telemetria`
  (sus `evento(...)` quedan = trazas gratis en la bitácora del informe).
- Cabecera JSDoc: «módulo compartido — motor de producción (PROD-2) e instrumento
  del informe» en vez de «INFORME-TELEMETRÍA v1».
- `informe/matriz.ts` L15: actualizar el import al nuevo path (única dependencia).
- **Pre-warm** al final del módulo (C5):
  ```ts
  if (typeof window !== "undefined") void rapidOcrInit().catch(() => {});
  ```
  Arranca al importar el bridge (antes de la primera captura) SIN tocar ScanView
  (intocable). Si el dueño dispara en <1-2 s, la captura espera el resto de la
  carga (aceptable, medido ~1.1 s).

### 4.2 `src/lib/e14/scanner-core-bridge.ts` (C2/C3/C5)

- Los 3 puntos de lectura pasan a `reconocerRapidOcr(...)` con la MISMA entrada
  que dejó el PROD-1 (`fotoOcr` en escaneo/recorte; original con fallback en el
  editor). El progreso `emitir({etapa:"OCR", progreso})` se alimenta del callback
  nuevo (real, por lotes de rec).
- `ocrBanda` (L489): `requestOcr(canvas...)` → `reconocerRapidOcr(canvas...)` —
  el canvas invertido ×2 ya es polaridad normal; RapidOCR lo lee (campos 6/6 en
  Frankfurt incluyen lo que aporta la banda).
- Log de auditoría: token nuevo `ocr=rapidocr conf=0.92 det=812ms rec=5430ms`
  (grep-able) junto al `ocrIn=` del PROD-1.
- `registrarPipelineE14` / `PipelineInfo` (informe/telemetria.ts): campos nuevos
  `ocrMotor: string` («rapidocr-v4») y `ocrConf: number | null` (default
  `""` / `null`) — el JSON del informe queda auto-descripto.

### 4.3 `src/lib/e14/informe/rapidocr.ts` — `rapidOcrReconocer` (C4)

- Firma: `rapidOcrReconocer(rt, dataUrl, onProgress?)` — callback OPCIONAL; tras
  cada lote de rec (6 líneas) reporta `i/total` (0→1). Sin callback: comportamiento
  actual byte a byte (el informe NO lo pasa — instrumento intacto).

### 4.4 Etiquetas de veracidad (C5)

- `informe/generar.ts`: donde las conclusiones describen el motor «actual»,
  reemplazar el sentido «motor del producto» por «Tesseract 1600 (motor anterior)»
  y una línea fija nueva: «motor de producción: RapidOCR PP-OCRv4». LÓGICA de la
  comparación INTACTA.
- `informe/referencia-lab.ts`: «hoy 27/56» → «motor anterior 27/56».
- `informe/telemetria.ts`: defaults de los 2 campos nuevos.

---

## 5. Presupuesto, timeouts y fallos

| Caso | Comportamiento exigido |
|---|---|
| Inferencia 6.4-8.6 s + pipeline | TIMEOUT_MS 15 s INTACTO — si vence: RECHAZADA ILEGIBLE controlada (igual que hoy). ANALIZANDO dura ~2-4 s más |
| Carga de modelos | ~1.1 s, singleton, pre-warm en background; la matriz del informe ya no la paga |
| `rapidOcrReconocer` falla (decode/ORT/0 cajas) | SIN fallback de motor — el fallo sigue el camino controlado que ya existe (texto vacío → gate decide, igual que hoy con tesseract) |
| Banda del sello | Misma lógica de 2.ª pasada; si el QA del dueño muestra regresión del sello, escape hatch: revert PUNTUAL de C3 (la banda vuelve a requestOcr) — documentado, no improvisado |
| Score | Puede moverse ±0.x (sigue al reconocimiento — ahora mejor). Criterios intactos |
| Memoria | Runtime compartido producción/informe (UNA sola carga por sesión) |

---

## 6. Validación del agente (headless, antes del PR)

1. `bun run lint` 0 · `tsc` 0 · build estático 3/3.
2. **Intocables = 0 archivos**: core npm, `ScanView.tsx`, `store.ts`, divipol,
   detection-worker.js, modelos/vendor, la LÓGICA de la matriz (los 9 celdas y su
   orden deben diff-er solo en import path del módulo movido).
3. Dev `:3001` sin errores de consola: **pre-warm visible** (evento
   `rapidocr/init` temprano, ANTES de la primera captura) · **SIM** chips
   8.2/7.0/4.3 intactos · **IMPORTAR** → log `ocrIn=original` + `ocr=rapidocr`,
   clasificación de cabecera OK (nivel AUTO en el asset que hoy la da), acta con
   `filtro=bw`.
4. Informe de telemetría sigue generándose: 9 celdas (la «actual» sigue corriendo
   Tesseract vía core — no debe romperse con el MOVE) + JSON con `ocrMotor`/
   `ocrConf`/`ocrInputFiltro`.
5. RECORTE manual y re-OCR del editor: `ocr=rapidocr` en logs.
6. **Clasificadores sobre texto RapidOCR**: verificar en headless que
   `clasificarCabecera`, `tipoDeBanda`, `codigoUnicoE14` y la paginación siguen
   clasificando los assets SIM/importados igual o mejor. Si algo CLASIFICA PEOR:
   DETENER y reportar (NO ajustar regex a ciegas en este kit — el texto nuevo es
   mejor en promedio; un regression puntual se documenta y decide el dueño).
7. No verificable headless: inferencia real en gama baja, sello en campo, batería —
   QA del dueño (§7).

---

## 7. QA del dueño en dispositivo (protocolo)

1. Capturar de nuevo **El Cairo P1** y **Frankfurt P2** (mismas condiciones que los
   informes base).
2. Esperado (de las celdas rapidocr del informe base): Frankfurt anclas 7→**9**,
   campos 3→**6**, GT 8→**13**, CER 60→**28**; El Cairo GT 10→**12**, conf ~0.92.
   El texto de REVISIÓN (editor OCR) será más limpio y por líneas.
3. ANALIZANDO ~2-4 s más larga — esperado, NO un defecto. La primera captura tras
   abrir el app no debe sentir la carga (pre-warm); si se siente, anotar el tiempo.
4. Verificar la banda del sello (kit/mesa en la píldora) y el código 1D
   (`cod:` en la traza).
5. REVISIÓN/ENVIADA siguen mostrando bw; «Imagen» descarga bw.
6. Enviar los 2 informes TXT/JSON — el análisis antes/después se hace sobre
   `celdas` + `ocrMotor/ocrConf/ocrInputFiltro` del pipeline.

---

## 8. Rama, base y entregables

- **Gate de dependencia (§1 del contrato de kits):** este kit repunta las MISMAS
  3 llamadas que re-hizo el PROD-1 → base obligatoria: **`feat/ocr-lee-original`**
  (HEAD del PROD-1). Si al empezar el PR del PROD-1 YA está mergeado a main, base =
  main actualizado (que ya incluirá también el informe si fue mergeado). NO se
  mergea nada por cuenta propia (regla fija).
- Rama: `feat/motor-rapidocr` · 1 PR → main **SIN merge** (espera auditoría).
- Commits sugeridos: (1) MOVE módulo + adaptador + 3 puntos + banda, (2) progreso +
  trazas + etiquetas, (3) docs.
- Docs: `docs/INSTRUCCIONES-e14-motor-rapidocr-v1.md` (este plan, verbatim),
  `docs/REPORTE-motor-rapidocr-v1.md` (nuevo: evidencia §1, decisiones §5,
  escape hatch banda), `docs/worklog.md` (append-only), `AGENTS.md` (registro).
- Rollback: revert del PR — sin migraciones, sin core, sin modelos nuevos.

---

## 9. Pitfalls (lista dura)

1. **CERO tuning del modelo**: det 1920/max, EP ["wasm"], lotes de 6, umbrales DB,
   dict ppocr_keys — EXACTO el código validado. WebGPU NO se activa (solo se
   anota). Cualquier «mejorita» va a OTRO kit con evidencia.
2. **NO tocar el core ni `requestOcr`** — el instrumento (celda «actual») lo
   necesita para medir antes/después.
3. **NO fallback de motor** — un solo motor de producción; el fallo sigue el camino
   controlado existente. (El fallback del PROD-1 es de IMAGEN, no de motor.)
4. **NO CDN**: todo vendido (`public/models/rapidocr/`, `public/vendor/onnxruntime/`)
   — verificar que ninguna ruta nueva apunta a internet (campo sin señal).
5. **Matriz congelada**: solo import path del módulo movido + etiquetas de
   veracidad; el orden/motores/variantes/medición intactos.
6. **Singleton compartido**: NO duplicar init propio; NO dejar que
   `resetInitsMatriz` (flag local de matriz.ts) confunda con el `rtSingleton` del
   módulo (ese sobrevive a los informes — verificar con un 2.º informe seguido).
7. **No ajustar clasificadores/regex al texto nuevo** en este kit — dejar medir;
   regression puntual → DETENER y reportar (§6.6).
8. El MOVE debe ser literal (mismo código): renombrar archivo + 1 import + JSDoc —
   sin «reordenar» ni «limpiar» nada más (diff auditable).
9. Todo en español, commits limpios, worklog append-only, PR sin merge.
