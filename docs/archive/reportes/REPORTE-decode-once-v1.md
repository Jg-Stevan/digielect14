# REPORTE-decode-once-v1 — SPRINT-A · CPU / pipeline de imagen

> Kit AGENTE-1-CPU · rama `perf/decode-once-v1` · base main `10209b7`
> Misión: eliminar la decodificación redundante de imágenes (4–7 decodes
> full-res de la MISMA foto por acta, ~30–40 % del CPU pre-OCR) y consolidar
> los helpers de canvas. Propiedad exclusiva respetada: SOLO los 11 archivos
> del kit + este reporte.

## 1. Resumen de commits (uno por tarea, orden del kit)

| Commit | Tarea | Contenido |
|---|---|---|
| `ebda9b7` | A1 | `perf(image)`: decode-once LRU compartido + re-cableo de consumidores |
| `574b959` | A2 | `refactor(ocr)`: rapidocr usa el decode memoizado del repo |
| `a9c4622` | A3 | `refactor(image)`: factory `canvasCon` + `analizarPixeles` (intro) |
| `a3d9278` | A3 | `refactor(masiva/deskew)`: canvas factory (3) |
| `2e1d4b8` | A3 | `refactor(masiva/identidad-qr)`: canvas factory (1) |
| `d1a26a3` | A3 | `refactor(masiva/dedup)`: canvas factory (1) |
| `a7ed4b0` | A3 | `refactor(masiva)`: canvas factory en archivos y origen (3) |
| `0075fd1` | A3 | `refactor(e14)`: orientacion/completitud/marco-escaneo (4) |
| `a4077ac` | A3 | `refactor(ocr)`: canvas factory en rapidocr (6) |
| `151e200` | A3 | `refactor(bridge)`: canvas factory en scanner-core-bridge (5) |
| `fa90959` | A3 | `refactor(image)`: canvas escalado del LRU usa la factory (1) |
| `0d41157` | A4 | `chore(bridge)`: fuera las dead stores `ultimoOcrConf/Det/Rec` |
| `38261b1` | A5 | `chore(e14)`: knip en mi zona (1 delete + 6 de-exports, 2 conservados por ancla) |
| `687b7b7` | A6 | `chore(e14)`: console→logger (14 llamadas en 4 archivos) |

## 2. Qué cambió por archivo

### `image-utils.ts` (núcleo)
- **`decodeImagenLru(url, {maxDim?})`** (A1): LRU de decodes tope 2 — mismo
  patrón literal de `loadImageMemo` (lección L7 de RAM) con dos mejoras:
  recencia real (hit re-ordena; la memo era FIFO de inserción) y **dedup de
  decodes en vuelo** (`Map<string, Promise>`) para que los 2 workers del pool
  (Opt-3) peguen al MISMO decode. Si se pide `maxDim` y la fuente excede ese
  lado largo, devuelve un canvas pre-escalado derivado del MISMO decode
  (escala `min(1, maxDim/ladoMayor)` — la receta exacta de `pixelesDeCapture`
  y del `canvasDeTrabajo` del banco), cacheado por `` `${url}|${maxDim}` ``.
- **`decodeImagenLruDeBlob(blob, {maxDim?})`** (A1): puente Blob→LRU — object
  URL por instancia vía `WeakMap` (URL.createObjectURL es barato y SIN
  decode de píxeles); la revocación vive en la eviction del LRU (disciplina
  de RAM: sin revocar, el object URL retiene los bytes del File).
- **Fuente = `HTMLImageElement`, NUNCA `ImageBitmap`**: un bitmap desalojado
  y `.close()` envenenaría al OTRO worker del pool (el <img> desalojado sigue
  válido para quien ya lo sostiene). EXIF intacto: el navegador aplica
  `image-orientation: from-image` al `<img>` por defecto.
- **`loadImageMemo` DELEGA a `decodeImagenLru`** (A1): mismo contrato (decode
  una vez, tope 2, mismo `<img>` de vuelta) — pero ahora es UNA caché para
  TODO el pipeline: los 4 call sites del bridge, `completitud`, tinta y
  rotación pegan al decode-once SIN tocar sus call sites (cero churn, cero
  cambio de contrato).
- **`canvasCon(ancho, alto)`** y **`analizarPixeles(fuente, maxDim)`** (A3).

### `ocr/rapidocr.ts` (A2 + A3 + A6)
- Fuera el `loadImage` privado (decode `<img>` sin memo): los 2 usos
  (`reconocerRapidOcr`, `rapidOcrCropsOrientacion`) van a `loadImageMemo`.
  El probe de orientación y la pasada-1 del escalonado consumen la MISMA
  dataUrl → el decode ahora también hace HIT (el det ya lo hacía por D62).
  Verificado contra la eviction tope 2: entre probe → pasada-1 → pasada-2
  solo viven fotoOriginal/fotoProcesada en la memo; el re-OCR de la banda
  corre DESPUÉS de la elección — sin dependencia con la entrada viva.
- 6 `createElement("canvas")` → `canvasCon`; 5 `console.info` → `logger.info`.

### `scanner-core-bridge.ts` (A1 vía delegación + A3 + A4 + A6)
- Los 4 `loadImageMemo` (calidadDeActa ×2, esquinasDeActa, fotoProcesada)
  pegan al LRU compartido por delegación — cero edición de call sites.
- 5 canvas → `canvasCon`; 4 `console` → `logger`.
- **A4**: fuera `ultimoOcrConf/Det/Rec` (3 declaraciones + 3 eslint-disable
  + 9 asignaciones + referencias en doc comments). Se escribían 9× y NUNCA
  se leían; la traza real vive en `confOcr/detOcr/recOcr` (capturados de
  `ocrEsc`, consumidos por las líneas `ocr=rapidocr` — verificados vivos en
  L1855/L2457).

### `masiva/archivos.ts` (A1 + A3)
- `maestroDeImagen` (nativo + wasm): el decode pega al LRU
  (`decodeImagenLruDeBlob`). EXIF intacto (from-image vía `<img>`),
  geometría y calidad JPEG intactas — el `createImageBitmap` original no
  pasaba `resizeWidth/Height`, así que `resizeQuality` era inerte y el
  caso común (≤12.2 MP) era un blit 1:1: cero diferencia de píxeles.
- `bitmapAMaestro` acepta `HTMLImageElement` (sin `close()` — la eviction
  del LRU libera); 2 canvas → `canvasCon` (master + render PDF).

### `masiva/origen.ts` (A1 + A3)
- `bitmapDeArchivo`: fuera el `createImageBitmap` privado
  `{resizeWidth: BITMAP_LADO}` → decode LRU + drawImage. Geometría
  replicada: ancho EXACTO `BITMAP_LADO` (resizeWidth no clampea — también
  upscale), alto proporcional; reescalado con el suavizado default del
  navegador (el que usaba el bitmap nativo por defecto).

### `masiva/deskew.ts` (A1 + A3)
- `decodeMaster`: fuera el `createImageBitmap` privado a escala real →
  decode LRU (HIT del decode ya hecho por `clasificarOrigen` del MISMO File
  dentro del intento) + blit 1:1 al canvas del master.

### `masiva/identidad-qr.ts` (A1 + A3 + A5 + A6)
- `pixelesDeCapture`: el decode pega al LRU con `maxDim = ladoLargo` — el
  canvas 2048 y el rescate 4096 derivan del MISMO decode (antes: 2 decodes
  `<img>` privados). Geometría byte-idéntica (misma fórmula de escala);
  fallo → `null` (sin-payload) como antes.
- A5: de-export de `ventanaDePixeles`, `jsQrDeVentana`,
  `ZXING_BARRIDO_PRESUPUESTO_MS`, `ZXING_BINARIZADORES`, `ZXING_FORMATO`
  (vivos SOLO internamente). **`barridoQrZxingDePixeles` SE CONSERVA
  exportado**: ancla exacta `qa-qr-identidad.ts:782` grepea la línea de su
  llamada.
- 3 `console` → `logger`.

### `masiva/dedup.ts` (A3 + A5)
- 1 canvas → `canvasCon`. **`dhash64DeDataUrl` SE CONSERVA**: aparece en la
  regex negativa de `qa-qr-identidad.ts:457` (regla 3 del kit: ancla →
  conservar; su doc ya decía «mantenida por compatibilidad»).

### `orientacion.ts`, `completitud.ts`, `marco-escaneo.ts`, `integridad.ts`
- Canvas → `canvasCon` (2 + 1 + 1 + 0). `orientacion`/`completitud`: 2+0
  `console` → `logger`. `integridad.ts`: sin canvases (nada que migrar).

## 3. Métrica A1 — decodes full-res de la imagen ORIGINAL por acta

**Ruta feliz de un acta nueva (masiva, sin master precalentado):**

| Etapa | Antes | Después |
|---|---|---|
| QR capa 0 (dataURL) | decode del core (`fileToCaptureDataUrl`) + `<img>` privado en `pixelesDeCapture` (+ otro para el rescate 4096 si tocara) | **1** (`decodeImagenLru` — el canvas 2048 y el rescate 4096 derivan del MISMO decode) |
| `clasificarOrigen` (Blob) | `createImageBitmap` privado | **1** (vía blob LRU — compartido abajo) |
| `preProcesoEscaneo` (Blob) | `createImageBitmap` privado a escala real | **0** — HIT del MISMO object URL |
| `maestroDeImagen` (Blob, si bakes) | `createImageBitmap` privado | **0** si la instancia ya está en el LRU |
| Pipeline bridge (fotoProcesada) | decode del core + `loadImageMemo` | idem (fuente DISTINTA — es el warp, no la original) |
| OCR | `loadImage` privado (sin memo) | 0 adicional (HIT de `loadImageMemo`) |
| tinta/completitud/calidad/esquinas | HIT memo | HIT memo delegada — 0 |
| **TOTAL imagen ORIGINAL** | **4–7** | **≤ 2** (1 vía dataURL del QR + 1 vía blob compartida origen→deskew→maestro) |

Conteo estático de llamadas `loadImage`/decode en la ruta feliz: los puntos
de decode con acceso al ORIGINAL quedaron en EXACTAMENTE 2 funciones
(`decodificarQrDeCapture`→`decodeImagenLru` y `decodeImagenLruDeBlob`), con
dedup en vuelo para el pool de 2 workers.

## 4. Desviaciones y decisiones documentadas

1. **`maestroDeImagen` nativo vía `<img>` en vez de `createImageBitmap`**:
   el original no pasaba `resizeWidth/Height` (solo `resizeQuality`, inerte
   sin resize) → el bitmap nacía a tamaño nativo y el caso común (≤4032 px)
   era un blit 1:1. El `<img>` del LRU reproduce exactamente eso. Para fotos
   >4032 px el downscale ahora ocurre en el drawImage (suavizado default del
   navegador — el mismo que usaba el blit original). Riesgo de score ≈ 0
   (el gate del master ±0.3 era para el re-encode JPEG, que no cambia).
2. **`bitmapDeArchivo` reescala en drawImage en vez de `resizeWidth`**:
   misma geometría (ancho exacto 256), resampler distinto — el detector es
   cosmético (D63-A: jamás tumba el pipeline) y sus umbrales son anchos.
3. **LRU con recencia (no FIFO)**: un hit re-ordena. La memo anterior era
   FIFO; con el orden real del pipeline (original↔procesada alternando) la
   FIFO podía desalojar la entrada caliente — la recencia es estrictamente
   más segura para el criterio del acta en vuelo.
4. **`canvasCon` no fija contextos**: cada caller pide el suyo
   (`willReadFrequently`/smoothing) porque `getContext` solo honra el primer
   conjunto de atributos — los bloques con semántica especial la conservan
   (PDF: «render, no lectura — D60 §T2.8», etc.).

## 5. Pendientes de integración (fuera de mi zona — NO editados)

- `masiva/runner.ts:433` — `document.createElement("canvas")` (thumb del
  dataURL en la rama dedup): archivo PROHIBIDO por el kit. Una línea:
  `const canvas = canvasCon(img.width, img.height);` con
  `import { canvasCon } from "../image-utils"`.
- El dedup de la cola (`dhashDeArchivo` en `masiva/dedup.ts`) conserva su
  `createImageBitmap` propio (fuera de la lista de re-cableo del kit A1;
  candidato natural para pegar al LRU en un sprint de integración).

## 6. Gate íntegro (bunx tsc --noEmit && bun run lint && bun run test; QA ×7; build)

```
── tsc ──
✓ tsc 0 errores (exit 0)
── lint ──
✖ 4 problems (0 errors, 4 warnings)   ← los 4 warnings PREEXISTÍAN en main
  (MasivaView recienListas/posCola, ScanView modoMenuMontado, logger.ts
  unused-disable) — 0 errores, 0 warnings nuevos.
── vitest ──
 Test Files  3 passed (3)
      Tests  53 passed (53)
── QA (7 suites) ──
qa-autoenvio.ts: QA autoenvío: 33/33 OK
qa-dedup-enviadas.ts: QA dedup-enviadas: 50/50 OK
qa-escaneo-ya-recortado.ts: QA escaneo-ya-recortado: 24/24 OK
qa-historico-enviadas.ts: QA historico-enviadas: 49/49 OK ✓
qa-identidad-acta.ts: QA identidad-acta: 32/32 OK
qa-qr-identidad.ts: QA qr-identidad: 72/72 OK
qa-watchdog-relectura.ts: QA watchdog-relectura: 34/34 OK
── build ──
○ (Static) prerendered as static content
build exit: 0
```

Los conteos de QA superan los 280/280 de la guía del repo porque e71/e72
añadieron casos — las 7 suites están en OK, que es lo que exige el kit.
