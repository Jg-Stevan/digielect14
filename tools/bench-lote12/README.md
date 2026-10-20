# Banco lote 6→12 del rec/cls PP-OCRv4 — KIT e14-bench-tiempos-v1 B2 (SOLO banco, cero producción)

Instrumento de medición para decidir **con datos** si doblar el lote del rec y del cls
(6 → 12) reduce el overhead de `session.run` sin cambiar el texto. **Este banco NO cambia
nada de producción**: `src/`, `public/` y configuración quedan intactos; aquí solo se
produce evidencia (kit Agente 3, dividido de `INSTRUCCIONES-e14-orientacion-tiempos-v1.md`).

- **GO (kit §2):** texto idéntico **100%** + Δconf ≤ 0.5 puntos + speedup ≥ **1.05×**.
- **NO-GO:** cualquiera que falle → no vale el cambio.

## Qué hay aquí

| Archivo | Rol |
|---|---|
| `bench.html` | Banco standalone (sin build, sin imports de `src/`): **lote 6 vs lote 12** del rec y del cls en el navegador con el EP wasm idéntico al de producción. |

## Cómo reproducir (pasos exactos)

> Requisito: `bun install` en la raíz del repo (la página carga ORT-web **desde
> `node_modules/onnxruntime-web/dist/ort.wasm.min.mjs`** — misma versión 1.30.0 fijada en
> `package.json`; los binarios vendidos en `public/vendor/onnxruntime/` son byte-idénticos).

```bash
bun install

# Servir la RAÍZ del repo como estático — con COOP/COEP para SAB + numThreads>1
# (paridad con Vercel D46; sin esas cabeceras corre numThreads=1 como GH Pages).
# Ejemplo con cabeceras: cualquier servidor estático con
#   Cross-Origin-Opener-Policy: same-origin
#   Cross-Origin-Embedder-Policy: require-corp

# Abrir el banco
#   http://localhost:PORT/tools/bench-lote12/bench.html

# Leer resultados: tabla en pantalla + botón manual «DESCARGAR JSON»
# (nada se descarga solo, §0.2). Lectura programática equivalente:
#   window.__benchJson  (el botón sigue siendo el canal manual)
```

## Qué mide y cómo (protocolo)

1. **EP idéntico a producción** (`src/lib/e14/ocr/rapidocr.ts:133-147`): `executionProviders: ["wasm"]`,
   `wasmPaths` → `public/vendor/onnxruntime/` (resuelto desde la página con `new URL(..., location.href)` —
   el ESM resuelve wasmPaths contra la URL del módulo), `simd: true`,
   `numThreads = min(4, cores)` solo con SAB + `crossOriginIsolated` (si no → 1, como GH Pages).
   `proxy` omitido (igual que el kit bench-rec-int8 — no afecta cifras, solo quién ejecuta).
2. **Corpus sintético determinista:** el MISMO generador del banco bench-rec-int8 (60 líneas estilo acta,
   seed `0xe14be6c5`, 3 fuentes monospace, tamaños 28-44 px sobre blanco) — MISMAS imágenes para los 2 lotes.
3. **Pre/post idénticos al motor:**
   - rec: orden global por ratio w/h, `W = floor(48 · max(320/48, ratios del lote))` (rapidocr.ts:783-808),
     tensor NCHW BGR `(x/255−0.5)/0.5` con resize punto-fijo a h=48 + pad de ceros, CTC greedy con
     `ppocr_keys.txt` y conf = media de probs de tokens seleccionados. Comparación de texto línea a línea
     en el MISMO orden, sin filtrar (igual que bench-rec-int8).
   - cls: orden de cajas tal cual (el cls NO se ordena en producción), h=48, w=min(192, ceil(48·ratio)) con
     pad a 192, `softmax2`, `p180 > 0.9 && p180 > p0 → rotar` (rapidocr.ts:740-761). Métrica de corrección:
     flags de rotación idénticos (cualquier flag distinto puede voltear una línea 180°).
4. **Protocolo:** por cada palanca (rec 6, rec 12, cls 6, cls 12), pasada 1 caliente (descartada) y pasada 2
   medida. **Determinismo:** correr ×2 con «REPETIR CORRIDA» — métricas de texto EXACTAS y ms dentro de ±10%.
5. **Memoria:** reporta el tensor máx por lote (`b·3·48·W·4` float32) — lote 12 pica al doble por run
   ([12,3,48,~W] vs [6,3,48,~W]); el kit estima [12,3,48,~320] ≈ 2.2 MB.

## Veredicto medido (ver REPORTE para la evidencia completa)

**NO-GO (rec) · GO (cls)** en sandbox 2 núcleos / HeadlessChrome 155 / numThreads=2 — el rec a lote 12
NO acelera (0.99×: los tensores W crecen al mezclar más ratios por lote y compensa el ahorro de runs) y
además cambia 1 línea de 60 (TESTIGO→TESTIG0, O→0). El cls sí gana ~1.25-1.30× con flags 100% idénticos.
Decisión final del dueño (DECISIONS.md queda intacto por diseño del kit).
