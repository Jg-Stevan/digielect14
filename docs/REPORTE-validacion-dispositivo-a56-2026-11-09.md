# REPORTE — validación en dispositivo real: **A56** vs A13

**Fecha:** 2026-11-09 · **Rama:** `remediacion/olas-a-d` @ `b5120a8` · **Servidor:** build estático raíz (`BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=`) en `:8123`
**Dispositivo:** Samsung **SM-A566E** (Galaxy A56 5G) · Android **16** (SDK 36) · Chrome **156.0.8078.47** · 8 núcleos · 7,6 GB RAM · 1080×2340 @ 450 dpi (override 352)
**Cómo se abrió:** `adb reverse tcp:8123 tcp:8123` → `http://localhost:8123/` (origen confiable). CDP en `tcp:9334` (el A13 usa 9333) y lectura del buffer `e14-obs`.
**Privacidad:** no se transcriben datos de actas ni se adjuntan fotos. Actas reales del mantenedor; sin imágenes sintéticas.

## 1 · Entorno del motor (evento `ocr:multihilo-entorno`)

| Campo | Valor |
|---|---|
| `crossOriginIsolated` | **true** |
| `hardwareConcurrency` | 8 |
| `topeThreadsPlan` | 6 |
| `ortConfig` | `numThreads: 6`, `proxy: true`, `simd: true` |

Mismo tope de hilos que el A13 (6), así que la diferencia de tiempos es de silicio y de carga del hilo principal, no de paralelismo configurado.

## 2 · Carga

- 0 recursos con HTTP ≥ 400.
- `obs:lcp-cls` [load]: LCP sin candidato, **CLS 0** (0 shifts). No se emitió muestra [final] en esta sesión.

## 3 · Corridas medidas (PerfActa del buffer)

Serie de 10 muestras con la app en una sola pestaña. El mantenedor alternó cámara con AUTO e importación de fotos reales (se ven clics «Importar imagen» y avisos de conversión HEIC en la sesión); `PerfActa` no registra el origen de cada corrida.

| # | Hora | Total | Proceso | OCR | Probe | Banda | Desenlace |
|---|---|---|---|---|---|---|---|
| 1 | 19:16:14 | 8,29 s | 1,46 s | 5,06 s | — | — | **OPTIMA 10,0** |
| 2 | 19:16:35 | 7,20 s | 1,30 s | 4,65 s | — | — | **OPTIMA 10,0** |
| 3 | 19:17:35 | 5,58 s | 1,09 s | 3,94 s | — | — | **OPTIMA 10,0** |
| 4 | 19:18:15 | 7,58 s | 1,30 s | 4,68 s | — | — | **OPTIMA 10,0** |
| 5 | 19:18:39 | 13,33 s | 1,29 s | 2,48 s | 5,95 s | 0,32 s | **RECHAZADA 4,9** (acta cortada en el encuadre) |
| 6 | 19:19:12 | 19,30 s | 1,78 s | 16,12 s | — | 1,13 s | **RECHAZADA 6,4** (intento 2 del anterior; rapidocr 13,4 s en dos pasadas) |
| 7 | 19:19:32 | 11,29 s | 2,67 s | 5,99 s | 2,40 s | — | **ADVERTENCIA 7,9** (ACTA RECORTADA · INF-IZQ) |
| 8 | 19:21:23 | 7,15 s | 1,30 s | 4,61 s | — | — | **OPTIMA 8,5** |
| 9 | 19:21:44 | 7,71 s | 1,34 s | 5,06 s | — | — | **OPTIMA 8,5** |
| 10 | 19:22:11 | 5,62 s | 1,11 s | 3,85 s | — | — | **OPTIMA 10,0** |

- **OPTIMA (7 corridas):** total 5,6–8,3 s · OCR 3,9–5,1 s · proceso 1,1–1,5 s.
- **Sin clasificar:** el acta cortada costó **32,6 s en dos intentos** (13,3 + 19,3 s) y terminó rechazada; el reintento interno hizo **dos pasadas de rapidocr** (7,4 + 5,9 s).

## 4 · Observaciones

1. **No hay bloqueo de hilo principal comparable al A13.** 24 `hang` en la sesión, máximo **1,41 s**, solo 4 ≥ 200 ms (en el A13: 54 `hang`, máximo **21,0 s**, 21 ≥ 200 ms). El anillo de progreso no se congela.
2. **El worker QR no se colgó ni una vez:** 0 avisos `capa0-qr hard-kill` (en el A13 hubo `kills=1..4` en cada sesión).
3. **Tesseract no llegó a correr:** el rescate del A56 fue una **segunda pasada de rapidocr**, no el cambio de motor.
4. **HEIC:** 4 avisos `HEIC rechazado por magic bytes sin despachar a heic2any (§6.13)` — archivos con extensión HEIC cuyo contenido no lo es; la app los procesa igual sin pagar la conversión. No es error.
5. **`msCrops` y `msSegundaPasada` siguen `null`** en las 10 muestras: la misma carencia de instrumentación que en el A13.
6. **Un `error` en el buffer (19:21:10, `TypeError … reading 'msPorMotor'`)** es de una lectura del agente por CDP, **no** de la app.

## 5 · Comparación A13 vs A56 (misma rama, mismo build, 6 hilos)

| Métrica | A13 (SM-A135M, Android 14, 3,8 GB) | A56 (SM-A566E, Android 16, 7,6 GB) | Ratio |
|---|---|---|---|
| Total OPTIMA (mediana) | ~64 s (50,0 · 70,4 · 59,9 · 68,1) | **~7,2 s** (5,6–8,3) | ≈ **9×** |
| OCR OPTIMA (mediana) | ~29 s | **~4,7 s** | ≈ **6×** |
| Proceso (detectar/crops) | 3,2–10,6 s | **1,1–1,5 s** | ≈ **4×** |
| `hang` máximo | **21,0 s** | **1,41 s** | ≈ 15× |
| `hang` ≥ 200 ms | 21 | 4 | 5× |
| QR hard-kill | 1–4 por sesión | 0 | — |
| Rescate más caro | 109,8 s (cadena 201 s) | 19,3 s (cadena 32,6 s) | ≈ 6× |

**Advertencia de comparabilidad:** las actas y las fotos no son las mismas (el A13 trabajó con capturas de cámara repetidas de la misma acta; el A56 mezcla importaciones y cámara), y la serie del A13 se midió en caliente tras varias capturas seguidas. El ratio de OCR y de long tasks se sostiene igual, porque ambas series corren el mismo motor con el mismo tope de hilos.

## 6 · Lectura

En el A56 la app **clasifica un acta buena en 5,6–8,3 s** y no bloquea el hilo principal: no hay anillo congelado, el QR no cuelga y el rescate interno cuesta una segunda pasada de rapidocr (≈6–13 s), no el cambio a tesseract. La diferencia con el A13 es de **~9× en total** y **~15× en el peor bloqueo**. El techo del A13 no es el motor OCR ni los hilos: es el trabajo síncrono que se lleva el hilo principal y la cadena de reintentos.

## 7 · Pendientes

1. Serie de **cámara pura** en el A56 (3 capturas AUTO del mismo acta con el mismo encuadre que el A13) para comparar sin la variable de la importación.
2. Forzar en el A56 un acta que no clasifique para medir el **rescate con tesseract** (no se ejerció).
3. Repetir el A13 sobre el **build actual** después de atacar el bloqueo del hilo principal (pendiente #3 del informe del A13).
4. Instrumentar `msCrops` y `msSegundaPasada` (igual que en el A13).
5. Confirmar en el panel del hub los envíos automáticos de ambas series.
