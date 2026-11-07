# PLAN-TROCEADO-PIPELINE — trocear `correrPipelineL2` y `pipelineRecorte` por etapas (7.3 · A2)

> Estado: **PLAN** (esqueleto, no ejecutado — la extracción es multi-PR).
> Anclas ya creadas en Ola 7: `politica/gate.ts` (la política del gate ya es
> un módulo), `politica/umbrales.ts` (los números), el tipo
> `Resultado<T, E>` en `politica/gate.ts`, y las sub-interfaces
> `PasosCaptura/PasosCalidad/PasosOcr/PasosGate` (7.8) que delimitan el
> contrato de cada etapa. El golden de paridad del gate
> (`politica/gate.paridad.test.ts`) es el cinturón que se abrocha ANTES de
> cada extracción.

## 0. El problema

`correrPipelineL2` (~958 líneas hoy, 8 etapas, ~15 variables mutadas en
clausura) y `pipelineRecorte` (~500 líneas): no se puede testear una etapa
sin ejecutar todo; los 3 flags de rama (`SIM`, `sinRecorte`, `rechazoTemprano`)
multiplican caminos. Cada ajuste toca una función gigante y el revisor debe
re-razonar el flujo entero.

## 1. Inventario — las 21 piezas de `PasosPipelineL2`

El contrato inyectado que hoy alimenta el cuerpo movido a `pipeline.ts`
(FASE F). Agrupado por etapa (7.8 — la intersección exacta vive en
`scanner-core-bridge.ts`):

| # | pieza | etapa propuesta |
|---|---|---|
| 1 | `conRampa` | captura (rampa de progreso — util transversal) |
| 2 | `decodeArchivoMemo` | captura · paso 1 (decode) |
| 3 | `quadIdentidad` | captura · paso 2 (detección, rama sinRecorte) |
| 4 | `esperarWorkerCaliente` | captura · paso 2 (worker OpenCV) |
| 5 | `calidadDeActa` | calidad |
| 6 | `scoreDeCalidad` | calidad · score bruto §4.1 |
| 7 | `contrasteEfectivoDe` | calidad (señal de legibilidad §X.1) |
| 8 | `senalDeContenido` | gate (señal §D1) |
| 9 | `esquinasDeActa` | gate (fiduciales) |
| 10 | `reconocerRapidOcrEscalonado` | OCR (PROD-2 escalonado) |
| 11 | `reconocerRapidOcrCascada` | OCR (cascada TESS→RapidOCR, GO-B) |
| 12 | `ocrBanda` | OCR (banda del sello §5) |
| 13 | `fmtClasif` | gate (traza de auditoría) |
| 14 | `construirActa` | cierre (entidad §3.1) |
| 15 | `evaluarGate` | gate (§4.2 — inyectado del bridge) |
| 16 | `DETALLE_ILEGIBLE` | gate (copy) |
| 17 | `DETALLE_INCOMPLETA` | gate (copy) |
| 18 | `DETALLE_SIN_VOTOS` | gate (copy) |
| 19 | `DETALLE_BAJO` | gate (copy) |
| 20 | `TECHO_SIN_SENAL` | gate (número — hoy re-exportado de politica/umbrales) |
| 21 | `TECHO_ESCUDO_FONDO` | gate (número — idem) |

Piezas del pipeline que NO viajan por `PasosPipelineL2` y formarán sus
propios pasos: guard de completitud (`verificarCompletitud`), marcadores
(`medirZonaVotos`), probe/brújula de orientación, QR de cámara (paralelo),
diagnóstico, log-contrato D51 (ya constructor único: `log-contrato.ts`).

## 2. El patrón de extracción

```ts
// politica/gate.ts ya lo declara:
type Resultado<T, E> = { ok: true; valor: T } | { ok: false; error: E };
// cada paso: (ctx: ContextoPipeline) => Promise<Resultado<PasoX, ErrorPaso>>
```

* **`ContextoPipeline`**: un solo objeto acumulador que reemplaza las ~15
  variables de clausura (`opciones`, `parcial`, `ms`, `fotoOriginal`,
  `quad`, `calidad`, `texto`, `completa`, `marcadores`, …). Cada paso lee lo
  suyo y escribe su salida tipada; NADA se muta fuera del ctx.
* **`ErrorPaso`**: unión cerrada por etapa (`DecodeFallido`, `DeteccionSinQuad`,
  `WarpFallido`, `OcrVencido`, …) — alimenta `clasificarErrorPipeline`
  (`src/lib/e14/errores.ts`, bloque 3.1) y de ahí el motivo de operador
  (`TEXTO_MOTIVO`). Conexión C5/3.1: el catch del store deja de adivinar por
  `message` y recibe el motivo ya clasificado.
* Los pasos que JAMÁS fallan (calidad, gate) devuelven `Resultado` con
  `ok: true` constante — la unión uniforme simplifica el orquestador.

## 3. Orden de extracción propuesto (una pieza por PR, la más pequeña posible)

| PR | paso extraído | por qué primero |
|---|---|---|
| 1 | `pasoDecode` (captura 1: `decodeArchivoMemo` + rampa) | puro, ya memoizado, 2 líneas de riesgo |
| 2 | `pasoDeteccion` (captura 2: worker caliente + `detectDocumentEdgesDetail` + quad identidad) | ya tiene rama única y traza (`quadOrigen`) |
| 3 | `pasoWarp` (processImage ×2 con variante OCR + fallback) | cara y testeable con fixture pequeño |
| 4 | `pasoCalidad` (`calidadDeActa` + esquinas + crop) | pura sobre dataUrl |
| 5 | `pasoOcr` (escalonado/cascada + banda + rechazoTemprano) | la más grande — entra con su presupuesto ya inyectado |
| 6 | `pasoCompletitud` (guard + marcadores + perdones) | solo lectura de imágenes |
| 7 | `pasoGate` (clasificación + `politica/gate.ts` + score final) | YA centralizado en 7.2 — este PR solo lo llama |
| 8 | `pasoCierre` (diag + log D51 + `construirActa`) | el remate; el log ya es constructor único |

`pipelineRecorte` se migra AL MISMO tiempo que 3-7: comparte pasos (el plan
original lo decía — «los helpers que §5 comparte con el recorte»), así que
cada PR extrae la versión común o deja el recorte para el paso siguiente,
nunca una tercera copia.

## 4. Criterio de parada

* Ninguna función del pipeline pasa de **~150 líneas**; cada etapa es
  testeable en aislado con fixtures pequeños (decode/detección/warp con
  imágenes sintéticas de `packages/scanner-core/tests/fixtures`).
* El golden de paridad del gate (7.2) sigue VERDE tras cada extracción — y
  antes de cada PR se abrocha (primero el cinturón, luego el salto).
* Los 3 flags de rama (`SIM`/`sinRecorte`/`rechazoTemprano`) quedan como
  datos del `ContextoPipeline`, no como `if` de clausura.
* Los tests existentes de frontera (2.2: `senal-lectura.fronteras.test.ts`,
  `clasificador.test.ts`, golden de 21 cabeceras) siguen verdes: la política
  no cambia, solo se centraliza.

## 5. Fuera de alcance de este plan

* El troceado NO toca `store.ts` (7.4, otro agente) ni divide el bridge en
  módulos por responsabilidad (7.6, multi-PR aparte — misma tierra, otra
  excavadora).
* No se cambia NINGÚN umbral ni copy: los números salen de
  `politica/umbrales.ts` y el copy del bridge, igual que hoy.
