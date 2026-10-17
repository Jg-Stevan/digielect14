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

---

## Quad-repro (KIT e14-quad-repro-v1) — reproducir y diagnosticar el quad sub-detectado

> Estado: **RIG COMPLETO Y VALIDADO (sanidad end-to-end) · paso oficial DETENIDO** — los 2 ZIPs de
> campo (`e14-diag-mesa-001-115643-i1.zip` / `e14-diag-mesa-002-115822-i2.zip`) NO llegaron al
> sandbox del agente (2026-10-17) y el kit es tajante: NO se ejecuta con fixtures inventados
> (`lab/fixtures/README.md`). Protocolo FILTROS-1: rig → evidencia → decisión.

### El rig (todo bajo `lab/` — producción INTACTA)

| Pieza | Qué es |
|---|---|
| `lab/quad-repro.html` + `lab/quad-repro.js` | Harness de detección aislado (vanilla): selector/drag&drop del `original.jpg` → protocolo REAL del worker (§3: `ready` → `detect` [bitmap transferido] → `result {corners normalizado}` / `busy` / `error`; y `warp` con quad de 8 fracciones) · dibuja el quad + esquinas TL-TR-BR-BL sobre la foto · crop estimado con el MISMO cálculo bbox→px de `calidadDeActa` (bridge: margen +3%/lado, min 8px, cap 2000 sin upscalar) + ratio h/w vs referencia 2.9 · botón «Warp con quad devuelto» + quad ideal manual (Fase 3) · panel EN VIVO de trazas. |
| `lab/worker-copy/detection-worker.js` | COPIA INSTRUMENTADA del worker `@4aa2e06` (header de procedencia — el original de `public/` es producción, parity CI). ÚNICAS diferencias = trazas parseables `console.info("[quad-repro] …")` + `post({type:"quad-repro"})` para el panel: `selectQuad` (cada candidato top-N: area/ratioAspect/whiteness/validateOk/score + ganador + polys:0 → H3 explícito), `refineQuadFromLines` (bad/fellBack por lado + nFallback → H1), handler `detect` (corners + frameW/H + contourCount). Cero cambios de lógica (verificado: las trazas son aditivas; sintaxis OK con `new Function`). |
| `lab/vendor → ../public/vendor` (symlink) | El worker deriva sus candidatos de opencv desde SU ubicación (`../../vendor/` y `../vendor/` — `opencvCandidateUrls`): desde `lab/worker-copy/`, la ruta `../vendor/` = `lab/vendor/` → el symlink hace que la COPIA cargue el MISMO opencv self-hosted (el CDN da 403 en el sandbox — la sanidad lo comprobó). En producción el original no lo necesita (carga de `/vendor/`). |
| `lab/fixtures/` | (BLOQUEADO) README de procedencia + los 2 `mesa-00X-original.jpg` esperados — pendientes de re-subida. NO está ignorado por `lab/.gitignore` (solo ignora `fotos/`). |
| `lab/resultados/quad-repro-sanidad-rig.png` | Lámina de SANIDAD del rig (control con `src/assets/acta-e14-real.jpg` — NO es resultado de campo): quad sano dibujado, trazas de la cascada visibles (pasada 1: 3 polys invalidadas → pasada 2: 1 poly ganadora ratio 2.966 score 0.55), crop estimado 692×2000, ratio 2.89, warp 701×2171. |

### Sanidad del rig (hecha — el AC «si el harness marca mal el control, el rig está mal» queda cubierto)

- Worker READY con probe completo (opencv self-hosted vía symlink).
- Control = acta real del repo: quad trapecio con tilt `[0.296,0.053 0.711,0.040 0.726,0.994 0.312,0.997]`,
  ratio estimado **2.89 ≈ 2.9** ✓, trazas de `selectQuad` (2 pasadas de la cascada) y `detect` en el panel,
  `warp` con el quad devuelto → 701×2171px. **El rig funciona de punta a punta.**

### Tabla H1-H4 × evidencia × veredicto (BLOQUEADA en la evidencia de trazas — queda preparada)

| Hipótesis | Evidencia de campo (kit §1, ya citada) | Trazas del rig que la deciden | Veredicto |
|---|---|---|---|
| **H1** `refineQuadFromLines` cayó a fallback | El quad del zip2 es un **rect PERFECTO alineado a ejes** (4 lados exactos `0.362/0.694 × 0.333/0.601`) — una detección sana (control zip1 y la sanidad del rig) da TRAPECIO con tilt. Un rect perfecto es la firma del `fallback[i]`. | `refineQuadFromLines` → `bad[]/fellBack[]/nFallback` (4=rect del fallback) | a llenar con el fixture |
| **H2** `selectQuad` eligió un contorno parcial | `y_bottom=0.601` coincide con la banda negra CANDIDATO/AGRUPACIÓN/VOTACIÓN — el quad termina JUSTO ahí (bloque superior completo, papel visible hasta y≈0.97) | `selectQuad` → cands[] con area/ratio/whiteness/score del GANADOR (¿un bloque superior ganó?) | a llenar con el fixture |
| **H3** `collectQuadCandidates` nunca generó uno que llegara al fondo | El papel inferior SÍ está en el frame (y≈0.97) — si el edge map cortó por sombra/brillante del pupitre, nadie lo vio | `selectQuad` → `polys:N, topN:M` + cands[] todas `validateOk:false` + cascada de pasadas | a llenar con el fixture |
| **H4** factor de captura en vivo (frame de video ≠ archivo) | Los ZIP son STORE sin re-encode (kit PROD-3 §3) → la Fase 1 por vía archivo debe REPRODUCIR el rect corto si es determinista | Si la vía archivo NO reproduce → H4 (documentado y se sigue igual — pitfall §9.10) | a llenar con el fixture |

### Propuesta de fix (rankeada — SOLO PROPUESTA, kit §2/§4-D; sin implementar)

Pendiente de la evidencia de trazas (el rig ya está listo para llenarla). Por la firma de campo
(rect perfecto + borde en la banda), las dos ramas de decisión ya preparadas por el kit §5-Fase 3:
si el quad ideal EXISTÍA entre los candidatos y perdió → fix de **SCORING** (`selectQuad`); si NUNCA
existió → fix de **GENERACIÓN** (`collectQuadCandidates`/canny). H1 (refine fallback) apuntaría a un
tercer fix: no aceptar un quad 100% fallback sin penalización.

### Cómo correr (cuando el dueño suba los 2 JPGs a `lab/fixtures/`)

```bash
ln -s ../public/vendor lab/vendor     # si el checkout no trae el symlink (Windows sin modo dev)
bunx serve .                          # o cualquier estático con la raíz del repo
# → http://localhost:3000/lab/quad-repro.html  (puerto libre — NO es el dev del app)
# 1) mesa-001-original.jpg → CONTROL: trapecio sano (ratio ~2.9) — si el rig lo marca mal, el rig está mal
# 2) mesa-002-original.jpg → OBJETIVO: reproducir el rect corto y leer las trazas [quad-repro]
# 3) «Warp con quad devuelto» + quad ideal manual → evidencia del contenido perdido (kit Fase 3)
```
