# lab/ — Laboratorio FILTROS-1 (kit plan-comparativa-filtros-e14)

Comparativa definitiva **2 motores OCR × 3 filtros** (original · texto-claro ·
gris — bw DESCARTADO) sobre fotos reales E-14 + galería visual para la
decisión estética del dueño + ZIP de evidencias. **SOLO laboratorio: cero
cambios de producción** (kit §2.1).

## Estado actual (2026-10-17)

| Pieza | Estado |
|---|---|
| Rig completo (filtros 1:1, crop, motores, matriz, métricas, láminas, galería, ZIP) | ✅ construido y validado en MODO HUMO |
| GT (Apéndice B: 14 anclas F/EG + 24 líneas Frankfurt P2) | ✅ `gt/gt.py` verbatim de `src/lib/e14/informe/analisis-texto.ts` (PR #10) |
| Modelos RapidOCR PP-OCRv4 | ✅ se reutilizan los del paquete `rapidocr_onnxruntime==1.4.4` (kit §2.2: NUNCA al repo) |
| Tesseract spa (tessdata_best) | ✅ `setup_env.sh` lo descarga a `cache/tessdata/` |
| **LAS 4 FOTOS REALES** | ❌ **BLOQUEANTE** — se perdieron con el reinicio del sandbox |

## BLOQUEANTE: faltan las 4 fotos del dueño

El lab previo (comparativa de motores: RapidOCR 49/56 · Tesseract tuned 39/56
· Tesseract hoy 27/56) corrió **fuera de cualquier repo**, en el sandbox
anterior. El reinicio del sandbox borró `/home/z/` completo (verificado:
historia completa de digielect14, web-scanner, web-scanner-monorepo-viejo y
digilect no contienen las fotos; `Downloads.rar` = diagnósticos de dispositivos
TXT; vault = 4 PDFs de ejemplo). Para re-correr:

1. **Re-subir las 4 fotos** a `lab/fotos/` (nombres esperados):
   - `Frankfurt-P2 foto campo (1).jpg` → GT F
   - `Frankfurt-P2 foto campo (2).jpg` → GT F
   - `Frankfurt-P2 limpia (scanner).jpg` → GT F
   - `El-Cairo-P1 (votos a mano).jpg` → GT EG
2. `bash lab/setup_env.sh`
3. `bash lab/run_filtros1.sh` → genera `lab/out/` + `lab/resultados/comparativa-filtros-e14-YYYYMMDD.zip`

Si los nombres difieren, editar `lab/fotos/manifest.json` (mapea archivo→GT;
sin manifest la GT se resuelve sola por el código 1D del texto OCR).

## Uso del modo humo (validación del rig — NO son números oficiales)

```bash
bash lab/setup_env.sh
bash lab/run_filtros1.sh --humo <ruta/foto.jpg>   # 18 inferencias (2×3×3)
```

Validado con `src/assets/acta-e14-real.jpg` (Frankfurt KIT 745 **P1** real —
única foto real disponible en el sandbox): ver `out/` en la entrada del
worklog con fecha 2026-10-17.

## Desviaciones documentadas (honestidad de proveniencia)

1. **Scripts del lab previo perdidos** (no commiteados a ningún repo). El rig
   es una re-implementación; en particular `crop_acta.py` (recorte del papel)
   NO es byte a byte el del lab previo → los números pueden desviarse
   levemente; el árbitro es la sanidad del kit §1 (RapidOCR 45–52/56 anclas ·
   CER ≤ 50%).
2. **Tesseract "tuned"**: la config exacta que logró 39/56 se perdió. Perfil
   reconstruido: `spa` (tessdata_best) · `--oem 1` · `--psm 6`, resolución
   completa (sin downscale). Documentado en `ocr_engines.py`.
3. **Filtros replicados en Python** (el app los ejecuta en el worker WASM,
   no importable desde Python): `filtros_app.py` replica 1:1 las funciones de
   `public/scanner/detection-worker.js` (fuente citada función por función;
   el propio worker declara ser «Espejo EXACTO de src/lib/scanner/
   image-modes.ts»). Redondeo `Uint8ClampedArray` (half-up) replicado.
4. **GT de líneas EG** (El Cairo P1): no existe en el informe — el kit §3 la
   define como "generar UNA vez por consenso": `bench.py --gen-gt` la produce
   y la valida contra las 14 anclas EG antes de usarla.

## Layout

```
lab/
├── gt/gt.py          GT verbatim (anclas F/EG · 24 líneas F · norm/lev/sim · CER)
├── filtros_app.py    original/texto-claro/gris — matemática EXACTA del worker
├── crop_acta.py      recorte nativo del papel (re-implementación documentada)
├── ocr_engines.py    rapidocr-v4 (det 1920/max, carga aparte) + tesseract-tuned
├── variantes.py      paso 2: crop + 3 variantes JPEG q90 + PNG
├── bench.py          pasos 3-5: matriz ×3 runs, métricas, sanidad, gen-gt
├── reporte.py        resultados.txt (estilo informe: tablas/ranking/recomendación)
├── laminas.py        láminas lado a lado + zooms + galeria.html
├── zip_pack.py       ZIP < 30 MB (variantes/láminas/galería/resultados/textos)
├── setup_env.sh      venv + rapidocr 1.4.4 + tessdata spa (NADA de esto al repo)
├── run_filtros1.sh   orquestador (oficial | --humo)
├── fotos/            ← LAS 4 FOTOS DEL DUEÑO (gitignored, no versionar)
├── cache/ · out/     (gitignored)
└── resultados/       ZIPs + copia TXT/JSON fuera del zip (kit §8)
```
