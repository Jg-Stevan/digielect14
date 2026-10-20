# Banco B7: tolerancia dedup heic/jpg — KIT e14-bancos-b5-b7-pagnull-v1 (D58) — SOLO EVIDENCIA, CERO PRODUCCIÓN

Instrumento de medición para la decisión **D61** (tolerancia/forma del dhash — las gemelas heic/jpg del dueño
171454 y 171446 cayeron a pipeline completo ~20 s+ en vez de la copia <1 s). **Este banco NO cambia nada de
producción**: `src/` y `public/` quedan intactos.

## Qué hay aquí

| Archivo | Rol |
|---|---|
| `bench.html` | Banco standalone: dhash 64-bit **copia congelada de `src/lib/e14/masiva/dedup.ts` L16-74** (canvas 9×8, gradiente horizontal, hex 16; `hamming64` y `HAMMING_MAX=6` verbatim — kit T2: «NO reimplementes un dhash distinto») sobre la **MISMA vía del pipeline**: `fileToCaptureDataUrl` importado del core de producción (`node_modules/@jg-stevan/scanner-core/dist/image-processor.js` — EXIF/12MP/HEIC) → `hacerThumb` 320 (copia congelada de `runner.ts` L64-87) → dhash. |
| `heic2any-esm.js` | Wrapper ESM del UMD de heic2any — SOLO banco: el core hace `import("heic2any")` (bare specifier) y el navegador lo resuelve vía import map del bench. En producción el bundler lo resuelve; aquí 0 diff en src/. |
| `resultados/` | Outputs JSON+MD de las corridas. |

## Qué mide y cómo (kit D58 §T2)

1. **Corpus sintético (mecanismo — corre en sandbox sin fotos reales):** 3 actas-like distintas (seeds fijas)
   codificadas en {png, jpg-q92, jpg-q50} → gemelas POR CONSTRUCCIÓN (mismo píxel-set). Hamming intra-par debe
   caer ≤ 6 si el mecanismo está sano. Canvas no encodea HEIC: la gemela HEIC REAL solo existe con las fotos del dueño.
2. **Sensibilidad al color (hipótesis HEIC→RGB ≠ JPG→RGB):** shift lineal por canal (R+δ, G+0.7δ, B+0.4δ,
   δ ∈ {1,2,3,5,8,12}) sobre la MISMA imagen → hamming vs base. Si un shift pequeño rompe el umbral 6, el color
   es PLAUSIBLE como causa del escape; si el umbral aguanta shifts grandes, el color probablemente NO es la causa.
3. **Corpus real (pendiente del dueño):** botón «CARGAR FOTOS REALES» — agrupa por stem numérico del nombre
   (171454.jpg + 171454.HEIC = par) y tabula hamming intra-par vs entre actas vs el umbral 6.
4. **Hipótesis ORDEN (kit T2 — alternativa):** el dedup pudo fallar por ORDEN, no por hash. Trazas a buscar en
   las capturas del dueño:
   - `[e14] dedup fila=<id> marcada hamming=<d> dupOf=<origen> hash=<hex>` (store.ts L180 — se marcó)
   - `[e14] dedup fila=<id> dupOf=<origen> reutiliza score=<s> ms=<ms>` (runner.ts L142 — copia OK)
   - `[e14] dedup fila=<id> sin-original reprocesa-completo` (runner.ts L188 — carrera: la original aún sin acta)
   
   Carrera documentada en código: `store.ts` L174-175 (solo marca filas aún PENDIENTES) y `runner.ts` L128
   (`!actaOrigen → return false` → fallback). Si NO hay traza `marcada` para el par → hash/color; si hay
   `marcada` + `sin-original` → ORDEN.

## Cómo reproducir (pasos exactos)

```bash
bun install
# Servir la RAÍZ del repo con COOP/COEP (igual que los otros bancos).
# Abrir: http://localhost:PORT/tools/bench-dedup-tolerancia/bench.html
# 1) «CORRER SINTÉTICO» → pares por construcción + sensibilidad color (JSON/MD descargables).
# 2) «CARGAR FOTOS REALES» con los pares jpg/heic del dueño → «CALCULAR DHASH DE LAS REALES».
# window.__benchJson = lectura programática. Outputs a resultados/ (NUNCA las fotos).
```

## Veredicto

La conclusión del kit (¿el umbral 6 atrapa los pares?) se emite en `docs/REPORTE-e14-bancos-b5-b7-pagnull-v1.md`
con: (a) el mecanismo sintético medido aquí, (b) la sensibilidad al color, y (c) los pares reales cuando el dueño
suelte las fotos (o las trazas de sus capturas, para la hipótesis ORDEN). El cambio de umbral es OTRO kit (D61) —
aquí SOLO evidencia.
