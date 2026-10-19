# REPORTE — KIT e14-informe-analisis-v1

**Rama:** `feat/e14-informe-analisis-v1` (desde main `01e4573`) · **PR:** DRAFT · **Fecha:** 2026-10-20
**Mandato:** pedido explícito del dueño (19/10): «informe automáticamente… en un archivo comprimido para analizar las imágenes sin modificar y modificadas». Reintroducción EN FORMA NUEVA del análisis retirado por `e14-fuera-informes-v1` (D43) — **nada se descarga solo: SIEMPRE detrás del botón «INFORME ↓» de RESUMEN (§0.2)**. El retiro sigue vigente para todo lo demás (acumulador localStorage, auto-descarga al rechazar, sección COMPORTAMIENTO).

---

## 1. Resumen

- **T1 — `src/lib/e14/informe.ts` (NUEVO, puro, sin React):** `generarInformeZip()` construye en el navegador (sin red, §0.7) un ZIP `e14-informe-<YYYYMMDD>-<hhmmss>.zip` con: `informe.json` (global, SIN dataURLs), `informe.txt` (legible, mismo contenido) y `actas/<id>-<nombre-sanitizado>-<estado>/` con `original.jpg` + `procesada.jpg` (byte-idénticos, sin re-encode) + `ficha.json` (acta COMPLETA menos fotos, `diagnostico` y `ocrTexto` incluidos).
- **T2 — `ResumenView.tsx` (modificado):** botón **«INFORME ↓»** en el hueco del retirado EXPORTAR REPORTE (estilo PROCESAR de MasivaView: verde marca, mono uppercase, min-h 44px, focus ring). Estados sin toasts (D2): «INFORME ↓ (COLA VACÍA)» disabled (chequeo `listarRegistros()` SOLO al montar) · «GENERANDO…» + píldora `role="status"` «GENERANDO INFORME…» · «LISTO ✓» 1.5 s (patrón ReviewView) tras descargar con `downloadBlob` del core · fallo → píldora `role="alert"` motivo ≤48 chars (patrón fallback IDB de MasivaView). `aria-label="Generar informe de análisis (ZIP)"`.

## 2. Whitelist vs diff real

| # | Archivo | Kit | Diff real |
|---|---|---|---|
| 1 | `src/lib/e14/informe.ts` | NUEVO | NUEVO (566 líneas, puro) |
| 2 | `src/components/e14/screens/ResumenView.tsx` | modificar | modificar (botón + estado + imports) |
| 3-5 | `docs/REPORTE…`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/worklog.md` | docs | docs |

`git status --porcelain` en la fase de código: EXACTAMENTE esos 2 archivos. Zonas prohibidas VACÍAS: `masiva/**` (cola consumida vía `listarRegistros`/`leerRegistro` tal cual — cero cambios), `scanner-core-bridge.ts`, `bridge.ts`, `public/**`, `next.config.ts`, `vercel.json`, `.github/**`, `src/assets/**`, `package.json`/`bun.lock` (fflate ya era dependencia directa desde PR #28 — **cero dependencias nuevas**). Pipeline, store principal, cola masiva y runner: solo LECTURA.

## 3. Evidencias T1/T2 (prueba funcional real, navegador headless + COOP/COEP locales, `crossOriginIsolated=true`)

Lote: 2 actas reales del dueño (mesa-001/mesa-002) + 1 procesada limpia + 1 `corrupto.jpg` (texto renombrado) + 1 `nota.pdf` → MASIVA → PROCESAR → RESUMEN → INFORME ↓.

**Desenlaces del lote (pipeline real, OCR wasm multihilo activo):**

| Archivo | Desenlace | Carpeta en ZIP |
|---|---|---|
| acta-m1.jpg | ENVIADA AUTO 8.5 (ÓPTIMA → auto-envío) | **NO** (exclusión ÓPTIMA/ENVIADA verificada en vivo) |
| acta-m2.jpg | ADVERTENCIA 7.9 (lectura FUERTE, quad sobel) | SÍ: original.jpg 1,677,085 B + procesada.jpg 189,279 B + ficha.json 4,687 B |
| acta-limpia.jpg | RECHAZADA BAJO 4.9 («NO SE RECONOCE INFORMACIÓN…») | SÍ: original 325,606 B + procesada 59,752 B + ficha 3,625 B |
| corrupto.jpg | ERROR pipeline «NO SE PUDO DECODIFICAR…» | SÍ: original.jpg 109 B (el Blob original) + ficha mínima |
| nota.pdf | ERROR guards FORMATO_NO_SOPORTADO | **NO** (solo fila en informe.json — §4.5) |

**Estructura del ZIP (20 entradas, TODAS método 0/STORE — JPEG ya comprimido, no se re-comprime):** `informe.json` (6,045 B) · `informe.txt` (1,711 B) · 4 carpetas `actas/<id>-<nombre>-<ESTADO>/` como la tabla. ZIP completo: 7,227,900 B.

**`informe.json` verificado:** parsea ✓ · `totales.actas=11` (la cola arrastraba filas de corridas previas — el informe lista TODAS) · `porEstadoFila {LISTA:3, ERROR:8}` ✓ · `porStatusActa {ENVIADA:1, ADVERTENCIA:1, RECHAZADA:1}` ✓ · `tiemposMediosMs {proceso:842, calidad:48, ocr:5430, total:6771}` (solo actas con diagnóstico — reales) · `deteccion {worker:1, sobel:2, null:0}` ✓ · `rechazos.porTipo {BAJO:1}` + `porDetalle` ✓ · **`rg 'data:image'` sobre informe.json + informe.txt → 0 matches (ceroDataUrls=true, §6)** ✓.

**Byte-identidad (§4.3):** `original.jpg` de las 2 carpetas LISTA comparado BYTE A BYTE contra `atob(acta.fotoOriginal)` leído de IndexedDB `e14-masiva-v1`: **`byteIdentico: true` en ambas** — longitudes exactas, primer byte-trío `[255,216,255]` (SOI JPEG) y último `[255,217]` (EOI) ✓. `ficha.json`: parsea, `sinFotos=true`, `conDiag=true` (diagnóstico completo), `ocrTextoPresente=true` ✓. Fichas mínimas ERROR `{id, nombre, estado:"ERROR", error}`: `ok:true` ×4 ✓.

**Capturas:** `resumen-cola-vacia.png` (botón disabled — §4.5) · `masiva-lote.png` · `masiva-resultado.png` (bandeja con desenlaces) · `resumen-informe-listo.png` (botón «LISTO ✓») — carpeta `humo-informe-analisis-2026-10-20/` del agente.

## 4. Verificación §4 (en orden)

1. `bun run lint` → **0-0** · `bunx tsc --noEmit` → **0** · `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bun run build` → **OK** (3/3 páginas estáticas).
2. **Paridad SIM/real:** el kit NO toca pipeline (whitelist §2 — diff de código = 1 módulo nuevo + 1 vista). Verificación en vivo del pipeline intacto: actas reales procesadas con desenlaces coherentes (ENVIADA AUTO por auto-envío D4, ADVERTENCIA con techo, RECHAZADA BAJO, `quadOrigen worker/sobel`, clasificación AUTO, lectura FUERTE/MEDIA) + SIM viva post-kit (puesto demo Frankfurt, 12 mesas, acta en curso, cero errores en consola). NOTA honesta: los ZIP de diagnóstico históricos (17/10, mesa-001 ADVERTENCIA 7.9 / mesa-002 RECHAZADA 6.4) son PREVIOS a kits de scoring posteriores (score-lectura, quad-sobel, lectura-perdona-lazo…) — sus desenlaces no son la línea base de main actual; la garantía de paridad de ESTE kit es la whitelista (cero archivos de pipeline tocados).
3. **Prueba funcional mínima:** hecha con 5 archivos (tabla §3) — estructura exacta ✓, informe.json parsea + totales + cero dataURLs ✓, byte-identidad ✓, ficha con diagnóstico sin fotos ✓.
4. **RAM (§4.4):** `performance.memory.usedJSHeapSize` antes 79,540,388 → después 60,093,322 B (GC tras generar — el heap NO se duplica; lectura secuencial `leerRegistro` uno-a-la-vez, referencias liberadas por iteración). Con 11 filas en cola (5 con carpeta).
5. **Cola vacía:** botón `disabled` con «INFORME ↓ (COLA VACÍA)» verificado en navegador antes de cargar el lote ✓; fila ERROR de guards (pdf suelto) aparece en informe.json sin carpeta ✓ (×2 — quedaron 2 del histórico).
6. **Peso del módulo (§4.6):** `informe.ts` = **7,068 B min** en chunk LAZY (< umbral ~8 KB) — y además carga **DIFERIDA** desde el botón (junto a `pdf-export`): delta del bundle inicial ≈ 0 (mismo patrón D47). Peso real del ZIP de prueba: 7.2 MB (4 carpetas con imágenes). Decisión documentada en **D49**.

## 5. Limitación documentada (kit §2)

**La fuente del informe es la cola MASIVA (IndexedDB `e14-masiva-v1`)** — el flujo INDIVIDUAL no persiste actas (`actaActual` vive en RAM y muere al re-escanear/recargar; comportamiento existente NO cambiado). El dueño procesa por jornada vía MASIVA → el informe cubre la jornada completa. Se imprime en `informe.txt` y queda en este REPORTE.

## 6. Desviaciones

**Ninguna BLOQUEADA.** Decisiones de interpretación (documentadas, ninguna altera el contrato del kit):

1. **Loop secuencial sobre TODAS las filas** (T1.1 literal: «para cada id, `leerRegistro(id)` UNO A LA VEZ») — las filas sin carpeta (ÓPTIMA/ENVIADA/guards/PENDIENTE) se leen y se sueltan sin extraer nada: cumple la letra y mantiene RAM acotada (una referencia viva por iteración).
2. **Estado en el nombre de carpeta** (T1.8): filas LISTA llevan su `statusActa` (RECHAZADA/ADVERTENCIA/EN_REVISION_HUMANA — el dato útil para el análisis); filas ERROR llevan `ERROR`.
3. **`error` en fichas mínimas puede ser `null`:** el runner persiste `{...registro, estado:"ERROR"}` conservando el Blob, pero el motivo corto vive solo en la fila liviana (memoria). El informe reporta lo que hay en IDB — sin inventar (misma filosofía del kit).
4. **`imagenesRecortadasA` = 50** (el tope aplicado) + `actasSinImagen` = ids que perdieron imágenes al recortar (las más antiguas por `agregadaEn` desc). El tope de 250 MB NO se activó en la prueba (estimado ~7 MB) — umbral verificado por código.
5. **`conteo` con claves fijas a 0** en `porEstadoFila`/`porStatusActa`/`deteccion` — JSON estable para consumos automáticos.

## 7. Pasos para el dueño

1. Revisar el PR (DRAFT — merge SOLO con orden explícita, como siempre).
2. Tras merge + deploy: MASIVA → procesar la jornada → RESUMEN → **INFORME ↓** → el ZIP cae en Descargas.
3. Descomprimir: `informe.json`/`informe.txt` para el análisis numérico; `actas/…/original.jpg` + `procesada.jpg` lado a lado para el ojo; `ficha.json` trae el diagnóstico completo (techos, gate, quadOrigen, tiempos, OCR).
4. RAR/ZIP/HEIC en cola → el informe los cubre igual (filas LISTA con status o ERROR con su Blob original).
5. Con >250 MB estimados de imágenes, el ZIP recorta a las 50 actas-problema más recientes y lo dice en `informe.json` (`imagenesRecortadasA` + `actasSinImagen`) — el JSON SIEMPRE lista todo.
