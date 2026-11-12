# REPORTE — validación en dispositivo real tras olas A–D + H1–H5

**Fecha:** 2026-11-09 · **Rama:** `remediacion/olas-a-d` @ `c6f5ed3` · **Servidor:** build estático raíz (`BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=`) en `:8123`
**Dispositivo:** Samsung **SM-A135M** (Galaxy A13) · Android **14** · Chrome **156** · 8 núcleos · 4 GB · 1080×2410 (384×857 CSS @ 2.8125)
**Cómo se abrió:** `adb reverse tcp:8123 tcp:8123` → `http://localhost:8123/` (origen confiable: COOP/COEP surten efecto). Observación por CDP (`tcp:9333`) y lectura del buffer `e14-obs` (IndexedDB).
**Privacidad:** no se transcriben datos de actas ni se adjuntan fotos. Todas las corridas usaron **actas reales** manipuladas por el mantenedor (cámara con AUTO y fotos importadas desde su galería); no se usó ninguna imagen sintética.

## 1 · Entorno del motor (evento `ocr:multihilo-entorno`)

| Campo | Valor |
|---|---|
| `crossOriginIsolated` | **true** (verificado también en la sesión de medición) |
| `hardwareConcurrency` | 8 |
| `topeThreadsPlan` | 6 |
| `ortConfig` | `numThreads: 6`, `proxy: true`, `simd: true` |

Multihilo REAL activo en el A13. **Advertencia de método:** por `http://<IP-LAN>:8123` el navegador considera el origen no confiable y **ignora COOP/COEP** (visto como warning de consola) → `crossOriginIsolated=false` y 1 hilo. No mezclar mediciones LAN con localhost.

## 2 · Carga

- 0 recursos con HTTP ≥ 400 en todas las cargas de la sesión.
- `obs:lcp-cls` [load]: LCP sin candidato, CLS 0.
- `obs:lcp-cls` [final] medidos en el mismo aparato: **LCP 2 309 ms, CLS 0.5795 con 853 shifts**; **LCP 45 175 ms, CLS 0.2652 con 354 shifts** (elemento `img.max-h-full.max-w-full`); y uno limpio: **LCP 3 606 ms, CLS 0.0293** (65 shifts). El CLS del editor del acta es alto y **muy variable** (0 a 0.58) — supera el umbral «poor» (0.25) en dos de cuatro cargas.

## 3 · Corridas medidas — serie limpia (una sola pestaña, actas reales)

Sesión única tras cerrar las pestañas extra, origen `localhost` (6 hilos). Muestras `perf` del buffer, en orden:

| Hora | Intento | Total | Proceso | OCR | Motores | Probe | Desenlace |
|---|---|---|---|---|---|---|---|
| 18:25:06 | 1 | **50,0 s** | 4,6 s | 21,6 s | rapidocr 21,4 s | 12,7 s | **OPTIMA** 8,5 |
| 18:30:52 | 1 | **70,4 s** | 10,2 s | 18,2 s | rapidocr 18,0 s | 9,6 s | **OPTIMA** 10,0 |
| 18:32:08 | 1 | **59,9 s** | 10,6 s | 36,8 s | rapidocr 36,8 s | — | **OPTIMA** 8,5 |
| 18:33:49 | 1 | **68,1 s** | 4,6 s | 59,0 s | rapidocr 22,3 + tesseract 17,9 | — | **EN_REVISION_HUMANA** 8,5 (ACTA SIN IDENTIFICAR) |
| 18:36:04 | 2 | **109,8 s** | 3,2 s | 92,0 s | rapidocr 52,2 + tesseract 14,8 | 9,3 s | **RECHAZADA** 4,9 |
| 18:36:54 | 3 | **23,2 s** | 3,2 s | 16,5 s | rapidocr 16,5 s | — | **RECHAZADA** 6,4 (ACTA INCOMPLETA · CORTADA) |

Las tres últimas filas son la **cadena de reintentos de la misma acta**: 68,1 + 109,8 + 23,2 = **201,1 s** hasta quedar rechazada en el intento 3 de 4.

**Atribución de origen:** `PerfActa` no registra si la corrida vino de cámara o de importación. Por los breadcrumbs del buffer, en esta sesión hubo ambas (clics «Importar imagen» del mantenedor y capturas AUTO de la cámara); la serie mezcla los dos caminos y no se puede segmentar por rendimiento. Es una carencia de instrumentación, no de comportamiento.

## 4 · Observaciones

1. **El hilo principal se bloquea durante «analizando».** 54 `hang` en la sesión, 21 de ellos ≥ 200 ms, con la pestaña **visible**: máx. **21,0 s** (justo tras importar), luego 12,6 s, 9,4 s, 5,9 s, 5,1 s y 4,6 s. Todos con breadcrumb `vista:analizando`. Esto explica el anillo de progreso congelado en 99 % y parte del «resto» entre `totalMs` y la suma de tramos (p. ej. 32,4 s sin atribuir en la corrida de 70,4 s).
2. **El rescate sigue siendo lo caro.** Las dos corridas que entraron en rescate pagaron rapidocr + tesseract y **~19-25 s de OCR no atribuidos a ningún motor** (`ocrMs` 59,0 vs 40,2 sumados; 92,0 vs 67,0). `msCrops` y `msSegundaPasada` llegan **siempre `null`** en todas las muestras: la segunda pasada y los crops no se están midiendo.
3. **Costo de la cadena de reintentos:** un acta que no clasifica consume **201 s y tres reintentos** antes de terminar rechazada; cada intento vuelve a pagar detector, probe y OCR.
4. **Worker QR colgado:** `worker=capa0-qr accion=hard-kill kills=1..4 presupuesto=8000+1500 — worker colgado (respawn perezoso)`. El kill-switch funciona en cada corrida; el respawn perezoso se paga otra vez en la siguiente.
5. **`ERR_UPLOAD_FILE_CHANGED` en consola** a las 18:29:55, mientras la UI mostró «ENVIADO AUTOMÁTICAMENTE». El rótulo de la UI **no prueba el POST** (ya conocido); este error apunta a que al menos un envío falló y quedó para reenvío. Verificar contra el panel del hub.
6. **Desenlace por clasificación, no por calidad:** la corrida 18:33:49 quedó en revisión humana con score final 8,5.
7. **El buffer descarta hangs por cuota:** `BufferDescartes` con `cuota-hang: 85` y `anti-recursion:hang: 15` (100 descartes agregados). La serie de long tasks está recortada; los 54 almacenados son un piso, no el total.
8. **Error `TypeError … reading 'join'`** en el buffer a las 18:37:44: es de una lectura del agente por CDP (`Runtime.evaluate`), **no** de la app. Se excluye del análisis.

## 5 · Estado de los arreglos H1–H5 en esta corrida

- **H4 (dedup PerfActa):** 0 descartes `perf-duplicado` y una sola muestra por acta — no se dio watchdog + desenlace tardío, así que la dedup no se ejerció.
- **H2/H1 (un pipeline, token de generación):** no se forzaron (sin cancelar ni interrumpir a mitad), pero con **una sola pestaña** no aparecieron análisis simultáneos ni adopción cruzada. La cadena de reintentos se ejecutó secuencial, intento tras intento.
- **H3 (desarme persistente):** no se disparó (sin `bad_alloc`).
- **H5 (geometría del crop):** sin cambios visibles; crops y lectura completaron normal en las 6 corridas.

## 6 · Lectura

Con una sola pestaña y 6 hilos reales, el A13 **clasifica un acta buena entre 50 y 70 s**, y el costo se dispara cuando no clasifica: el rescate duplica el OCR y la cadena de reintentos llega a **201 s** para terminar rechazada. El hallazgo nuevo es que **el hilo principal se bloquea hasta 21 s** durante «analizando»: el anillo se congela, el progreso salta y el aparato deja de responder. Orden de ataque: (1) sacar del hilo principal el trabajo síncrono de detección/crops, (2) instrumentar `msCrops`/`msSegundaPasada`, (3) revisar el CLS del editor, (4) decidir si la cadena de reintentos debe seguir pagando el rescate completo.

## 7 · Corrección de la medición previa

La primera tanda de este informe (tres sesiones en el buffer, «sin muestra PerfActa») **queda descartada como confounder**: las pestañas extra las abrió el agente con `am start`, y la muestra «faltante» del intento 1 (~112,7 s, 18:12:25) **sí estaba** en el buffer — la lectura del agente usaba `slice(-8)` sobre claves no ordenadas por tiempo. No fue un fallo de observabilidad de la app.

## 8 · Pendientes

1. Medir la misma serie en el **A56** (gama media/alta) para comparar.
2. Instrumentar `msCrops` y `msSegundaPasada` (hoy siempre `null`) y atribuir el OCR no contabilizado del rescate.
3. Investigar el bloqueo de 21 s del hilo principal en «analizando» (orden de ataque #1 de §6).
4. Revisar el CLS del editor (hasta 0.5795 / 853 shifts) — D3.
5. Confirmar en el panel del hub si el `ERR_UPLOAD_FILE_CHANGED` dejó actas sin enviar y cómo las reintenta.
6. Validar H1/H2/H3 con acciones dirigidas (cancelar/interrumpir a mitad de análisis; forzar `bad_alloc`).
7. No repetir mediciones de rendimiento por IP LAN: ahí corre 1 hilo por COOP/COEP ignorado.
