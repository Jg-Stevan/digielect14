# REPORTE — Tesseract `fast` vs `best` en el gate de clasificación (2026-11-10)

**Fecha:** 2026-11-10 · **Rama:** `remediacion/olas-a-d`
**Petición del dueño:** «quiero probar tesseract best, fast, quiero saber si logran
clasificar el acta con la lectura que hacen y cuánto tiempo tardan».
**Regla de privacidad:** solo se reportan tiempos y veredictos de rendimiento; las
actas usadas son del corpus local del dueño, no se versionaron, no se transcribió
contenido y los fixtures temporales se borraron al terminar.

## 1 · Método (sin cambios de código)

A/B sobre el mismo build (`out/` + `serve-coop-coep.mjs`, `crossOriginIsolated=true`):

1. Primera pasada Tesseract forzada con el flag existente
   `ocrPrimeraPasadaRapida=false` (producción hoy usa `true` = RapidOCR primero).
2. Único cambio entre variantes: el traineddata servido en
   `out/models/tess/spa.traineddata.gz`.
   - `best`: 11 982 037 B · sha256 `724c20ba…` (4.0.0_best, lock actual).
   - `fast`: 1 132 440 B · sha256 `f3a3fe05…` (tessdata_fast oficial).
3. Entre variantes se limpian IndexedDB (`keyval-store`), `cache_storage` y caché
   HTTP, porque tesseract.js reutiliza el traineddata cacheado.
4. Se importa la misma imagen por el `input[aria-label="Importar imagen"]` y se lee
   la muestra `tipo:"perf"` del store IndexedDB `e14-obs` (`PerfActa.lectura`:
   validación del gate por motor y ms por intento).
5. Tres actas del corpus local: `084906`, `085053`, `acta-real`. Recarga de página
   entre importaciones en los equipos lentos (ver §6).

## 2 · Resultados

Tiempo de Tess = intento 1 (ms). Total = pipeline completo (s). Veredicto final =
status del pipeline tras la cascada.

### Samsung A56 (SM-A566E)

| Acta | Variante | Tess | Veredicto Tess | Final | Total |
|---|---|---|---|---|---|
| 084906 | best | 3 625 | SUGERIDA → RapidOCR 3 683 | OPTIMA 10 | 8,36 s |
| 084906 | fast | 1 808 | SUGERIDA → RapidOCR 3 583 | OPTIMA 10 | 6,93 s |
| 085053 | best | 2 558 | AUTO | ADVERTENCIA 7,9 | 3,54 s |
| 085053 | fast | 1 526 | AUTO | ADVERTENCIA 7,9 | 2,39 s |
| acta-real | best | 3 726 | AUTO | OPTIMA 10 | 6,37 s |
| acta-real | fast | 1 488 | AUTO | OPTIMA 10 | 4,14 s |

### PC (Chrome de escritorio — CPU del host al 85–97 % durante la serie)

| Acta | Variante | Tess | Veredicto Tess | Final | Total |
|---|---|---|---|---|---|
| 084906 | best | 6 513 | SUGERIDA → RapidOCR 4 885 | OPTIMA 10 | 13,3 s |
| 084906 | fast | 3 536 | SUGERIDA → RapidOCR 5 858 | OPTIMA 10 | 11,8 s |
| 085053 | best | 4 726 | AUTO | ADVERTENCIA 7,9 | 6,95 s |
| 085053 | fast | 1 677 | AUTO | ADVERTENCIA 7,9 | 3,34 s |
| acta-real | best | 5 849 | AUTO | OPTIMA 10 | 10,05 s |
| acta-real | fast | 2 425 | AUTO | OPTIMA 10 | 7,27 s |

### Samsung A13 (SM-A135M)

| Acta | Variante | Tess | Veredicto Tess | Final | Total |
|---|---|---|---|---|---|
| 084906 | best | 21 632 | SUGERIDA → RapidOCR 14 026 | OPTIMA 10 | 42,30 s |
| 084906 | fast | 9 294 | SUGERIDA → RapidOCR 14 404 | OPTIMA 10 | 30,20 s |
| 085053 | best | 16 884 | AUTO | ADVERTENCIA 7,9 | 21,62 s |
| 085053 | fast | 7 459 | AUTO | ADVERTENCIA 7,9 | 13,21 s |
| acta-real | best | 22 987 | AUTO | OPTIMA 10 | 36,80 s |
| acta-real | fast | 9 900 | AUTO | OPTIMA 10 | 22,21 s |

### TECNO KN3 (Android 15, Chrome 157, 720×1600)

| Acta | Variante | Tess | Veredicto Tess | Final | Total |
|---|---|---|---|---|---|
| 084906 | best | 8 521 | SUGERIDA → RapidOCR 13 165 | OPTIMA 10 | 25,53 s |
| 084906 | fast | 5 801 | SUGERIDA → RapidOCR 16 738 | OPTIMA 10 | 28,12 s |
| 085053 | best | 6 112 | AUTO | ADVERTENCIA 7,9 | 9,26 s |
| 085053 | fast | 3 244 | AUTO | ADVERTENCIA 7,9 | 6,50 s |
| acta-real | best | 8 477 | AUTO | OPTIMA 10 | 17,35 s |
| acta-real | fast | 4 087 | AUTO | OPTIMA 10 | 12,94 s |

## 3 · Lectura

- **Clasificación idéntica:** en los 24 pares (4 equipos × 3 actas × 2 variantes),
  `fast` produce el **mismo veredicto de gate y el mismo status final** que `best`.
  Ninguna acta ganó o perdió AUTO por usar `fast`.
- **Velocidad:** `fast` tarda **1,5–2,8× menos** en la lectura (rango por equipo:
  A56 1,7–2,5× · PC 1,8–2,8× · A13 2,3× · KN3 1,5–2,1×). El total del pipeline
  baja 0,8–12 s según acta y equipo.
- **Descarga:** el asset cae de 11,98 MB a 1,13 MB gz (−90,5 %), lo que también
  reduce mucho la primera descarga en 3G (deuda «primera-descarga» del
  `REPORTE-ocr-tessbest-cascada-v1`).
- **Acta difícil (`084906`):** ninguna variante cierra AUTO con Tess; el pipeline
  paga la pasada RapidOCR igual. En KN3 RapidOCR sí aceptó AUTO (OPTIMA 10); en
  A56/PC/A13 quedó en SUGERIDA hasta el cierre.

## 4 · Decisión del dueño (2026-11-10)

**Primer motor de OCR = Tesseract `fast`** con escalonado a **PP-OCRv4**
(RapidOCR: 1280 → 1920 → ROI). Es la cascada GO-B ya existente, cambiando el
sabor del traineddata a `fast` y el default de primera pasada a Tess.

**Implementado** en el commit de D88: el asset servido es `fast` en una ruta
versionada (`/models/tess/4.0.0_fast/`) y el default de
`ocrPrimeraPasadaRapida` es `false` (Tess primero). Kill-switch: ponerlo en
`true` en `public/flags.json` o en el override de localStorage.
## 5 · Deuda abierta (exigida por el dueño)

**Investigar por qué la lectura de Tess no cierra AUTO en el acta `084906`**
(SUGERIDA con `fast` y con `best`, en los 4 equipos: no depende del sabor).
Pistas a revisar, sin tocar el motor antes de medir:

- qué campos de cabecera rechaza `clasificarCabecera` en esa acta (DIVIPOLA vs
  texto leído vs completitud) y con qué conf;
- si es un problema de recorte/encuadre de la imagen (la MISMA acta sí pasa con
  RapidOCR en KN3 y en la pasada 1280 de los demás equipos);
- umbrales del gate por campo (comparar el detalle por descriptor de
  `contrato-motor.json`).

Cualquier corrección del clasificador es cambio de comportamiento del motor
compartido: exige regenerar el golden y aplicarlo igual en `supervision-e14`.

## 6 · Nota operativa (fiabilidad de la medición)

Fallos intermitentes del worker de Tess al importar actas consecutivas sin
recargar la página (visto en A13 y PC; con recarga limpia se reproduce bien).
No es un fallo de lectura del acta: es estado del worker/página entre corridas.
El harness de medición recarga entre actas para evitarlo; en producción cada
acta llega tras una captura nueva, no tras importaciones encadenadas.

## 7 · Implementación (D88, ejecutada)

1. `scripts/assets.lock.json`: `spa.traineddata.gz` = `4.0.0_fast` de naptha
   (sha256 `8db1167a…`, descomprime al fast `6f2e04d0…`), en
   `public/models/tess/4.0.0_fast/`.
2. `src/lib/e14/ocr/tesseract.ts`: `langPath` versionado
   (`/models/tess/4.0.0_fast`) — invalida IndexedDB de tesseract.js,
   MOTOR_CACHE del SW y HTTP.
3. `src/lib/e14/flags.ts`: default `ocrPrimeraPasadaRapida: false` (Tess
   primero; el dueño conserva el kill-switch en `true`).
4. `supervision-e14`: mismo traineddata y ruta versionada
   (`/models/tesseract/4.0.0_fast`) para mantener la paridad del motor.
5. `bun run preparar` + `bun run verificar` (typecheck, lint, tests y tests del
   paquete) y cotejo `qa-paridad-motor` contra el hermano.
6. Decisión registrada en `docs/DECISIONS.md` (D88, enmienda de D85).
7. Validación en iOS (Safari/WebKit) pendiente de un Mac con Web Inspector; el
   entorno HTTPS de LAN con CA local quedó probado.
