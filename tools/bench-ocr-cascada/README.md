# Banco OCR cascada A/B/C — KIT e14-bench-ocr-cascada-v1 (K3 fase 1 — SOLO banco, cero producción)

Instrumento de medición para el **GO/NO-GO** de la cascada OCR del paso 6 del
flujo del dueño (plan flujo-dueño: intento 1 → **gate** (clasificador puro) →
core RapidOCR como hoy → rescate por **ROIs** top/bottom). **Este banco NO
cambia nada de producción**: `src/`, `public/` y configuración quedan intactos
(la fase 2 — scaffold con flag `masivaOcrTesseract` default OFF — vive en su
propio commit).

## Qué hay aquí

| Archivo | Rol |
|---|---|
| `bench.html` | Banco standalone (se abre en el navegador, sin build): carga las fotos del lote + verdad terrena editable por foto, corre 3 cascadas sobre LA MISMA entrada y descarga JSON+MD. |
| `vendor/bench-kit.congelado.js` | Bundle CONGELADO con los módulos REALES de producción (RapidOCR PP-OCRv4 + clasificador DIVIPOL + decisión del escalonado + cliente del detection-worker) — el MISMO juez y el MISMO motor que prod. Ver el COMMIT FUENTE en su cabecera. |
| `entry-bench.ts` + `bench-shim.ts` | Fuente del bundle congelado (re-exports de `src/lib/e14/**`). |
| `generar-vendor.sh` | Regenera el bundle tras cambios de `src/` (esbuild ya instalado en el repo). |

## Las 3 cascadas

| Arm | Definición (brief K3) | Deps |
|---|---|---|
| **A** | RapidOCR **escalonado de hoy**: 1280 → `necesitaSegunda` → 1920 completo → `elegirMejor`. | cero nuevas |
| **B** | **Tesseract** completo (tesseract.js por CDN — OK aquí, es tools/) → **gate** → si no AUTO: RapidOCR-**ROI** (top 0-25% + bottom 75-100%, cap 1920). | tesseract.js + `spa.traineddata` (~2-15 MB, solo este banco) |
| **C** | RapidOCR **1280** completo → **gate** → si no AUTO: RapidOCR-**ROI** (control sin deps nuevas). | cero nuevas |

**La entrada es UNA por foto**: decode (EXIF, HEIC vía heic2any) → detección de
quad con el `detection-worker` REAL (OpenCV, `public/scanner/detection-worker.js?v=8`,
mismos budgets 4000+1500 ms del pre-scan) → warp SIN rotar → ese warp
(dataURL JPEG 0.92) alimenta las 3 cascadas — se aísla el OCR del resto del pipeline.

**El juez es el REAL de prod**: `clasificarCabecera(texto, divipol.json)` — el
mismo clasificador que decide el acta en el pipeline (nivel AUTO/SUGERIDA/MANUAL).
Entre motores distintos decide el GATE (jamás se compara conf Tesseract vs
RapidOCR — advertencia documentada en `scanner-core-bridge.ts` sello
TRANSMISIÓN blanco-sobre-negro y `clasificador.ts` MESA IMPOSIBLE 001→004).

## Cómo correrlo (pasos exactos)

```bash
bun install   # solo la 1.ª vez
# Servir la RAÍZ del repo con COOP/COEP (crossOriginIsolated → numThreads>1 de ORT,
# igual que prod; el mismo servidor de los bancos tools/):
bun run tools/serve-coop-coep.js 8123
# Abrir: http://localhost:8123/tools/bench-ocr-cascada/bench.html
```

1. **CARGAR FOTOS DEL LOTE** — las fotos REALES del dueño (heic/jpg/png; HEIC
   decodificado con heic2any vendido en el bundle).
2. **Verdad terrena** (tabla editable) — por foto: `dep` (2d) · `mun` (3d) ·
   `zon` · `std/puesto` · `mesa` esperados (códigos DIVIPOL). Campos vacíos no
   participan. Sin NINGUNA verdad la fila cuenta «AUTO (sin verdad)» y no entra
   al criterio duro.
3. Budget de Tesseract (default 60 000 ms — la 1.ª recognize descarga
   `spa.traineddata`; el warm-up descartado la descarga ANTES de medir).
4. **CORRER BENCH (A · B · C)** — por acta: warp una vez → A → B → C. Las
   fotos SIN quad (el pre-scan de prod tampoco lo tendría) quedan excluidas
   con nota honesta.
5. **DESCARGAR JSON+MD** (o `window.__benchJson` en consola).

## Qué mide y cómo decide

- **Por acta/cascada**: veredicto del gate (`AUTO-OK` = AUTO y TODA la verdad
  coincide · `FALSO-AUTO` = AUTO con algún campo mal — lo que el brief llama
  "las gemelas/la ERROR no pasan" · `no-AUTO` · `ERROR`), ms total, rescate
  ROI (sí/no), campos leídos, nº de anclas y señal (FUERTE/MEDIA/DEBIL).
- **Agregados por cascada**: n, AUTO-OK (+sin-verdad), FALSO-AUTO, no-AUTO,
  rescates, fallos, p50/p95 ms.
- **Criterio del brief** (tabla ✓/✗ calculada para B y C contra A — la
  **evidencia**; el **GO lo declara el dueño**):
  1. `AUTO-OK ≥ A` — no perder NI UNA acta.
  2. `falsos AUTO = 0`.
  3. `p50 ≤ A × 1.2`.
  4. `no-AUTO ≤ A` — proxy de «menor nº de filas que hoy caen a
     rescate/probe» (las no-AUTO son las que en prod van a revisión).
  - B gana ⇒ se implementa Tesseract en prod (`masiva/ocr-tesseract.ts`, flag
    ON). B pierde pero C gana ⇒ se implementa C (misma arquitectura, cero deps).
    Ni B ni C ⇒ **NO-GO documentado** (patrón P3-dhash) y la fase 2 queda solo
    en el scaffold flag-OFF.

## Advertencias honestas

- El banco corre en el equipo que lo abre: mide el dispositivo del dueño (esa
  es la gracia). Corridas ×2 con «REPETIR» para estabilidad (±10% esperable).
- El warm-up RapidOCR/Tesseract es descartado, pero p50/p95 sobre pocas fotos
  sigue siendo ruidoso: más fotos = mejor evidencia.
- El det de RapidOCR lleva memo de origen (D62): la 2.ª pasada a 1920 sobre la
  MISMA dataURL es una inferencia nueva (cap distinto → miss natural), como en
  prod.
- Sin presupuesto del pipeline del runner aquí: el banco mide OCR puro (el
  reloj real del dueño es el del dispositivo).
- tesseract.js se carga por CDN (jsdelivr) con `crossorigin=anonymous` —
  compatible con el COEP del servidor de bancos; sin red, B reporta error
  honesto y A/C siguen.
