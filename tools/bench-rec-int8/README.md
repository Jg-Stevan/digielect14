# Banco int8 del rec PP-OCRv4 — KIT e14-rec-int8-v1 (SOLO banco de pruebas, cero producción)

Instrumento de medición para decidir **con datos** si la cuantización dinámica int8 del
rec `ch_PP-OCRv4_rec_infer.onnx` cumple los umbrales de adopción. **Este banco NO cambia
nada de producción**: `src/`, `public/` y configuración quedan intactos; aquí solo se
produce evidencia.

- **GO:** velocidad ≥ 1.3× · texto idéntico ≥ 99% de líneas vs fp32 · conf media con delta ≤ 0.5 puntos.
- **NO-GO:** cualquiera que falle → se archiva la idea (o se explora otra variante con otro kit).

## Qué hay aquí

| Archivo | Rol |
|---|---|
| `cuantizar.py` | T1 — cuantiza dinámicamente el rec a int8 (`quantize_dynamic`, **QUInt8** — fallback del kit §3-T2.7; ver desviación abajo). El artifact **NO se commitea** (`.gitignore`: `tools/bench-rec-int8/*.onnx`). |
| `bench.html` | T2 — banco standalone (sin build, sin imports de `src/`) que corre **fp32 vs int8 en el navegador** con el EP wasm idéntico al de producción. |
| `*.onnx` (locales) | `ch_PP-OCRv4_rec_infer.onnx` (copia fp32 desde `public/models/rapidocr/`) e `ch_PP-OCRv4_rec_int8.onnx` (generado). Ambos ignorados por git. `ch_PP-OCRv4_rec_preprocesado.onnx` es el intermedio del paso previo oficial de ORT (ver desviación abajo). |

## Cómo reproducir (pasos exactos)

> Requisitos: `bun install` en la raíz del repo (la página carga ORT-web **desde
> `node_modules/onnxruntime-web/dist/ort.wasm.min.mjs`** — misma versión 1.30.0 fijada en
> `package.json`; los binarios vendidos en `public/vendor/onnxruntime/` son byte-idénticos)
> y Python 3 con pip.

```bash
# 1. Copiar el modelo fp32 (LECTURA — el original no se modifica)
cp public/models/rapidocr/ch_PP-OCRv4_rec_infer.onnx tools/bench-rec-int8/

# 2. Dependencias del banco (tooling local — NO toca package.json/bun.lock)
pip install onnxruntime onnx

# 3. Cuantizar (genera ch_PP-OCRv4_rec_int8.onnx, ~2.75 MiB desde ~10.35 MiB)
python3 tools/bench-rec-int8/cuantizar.py

# 4. Servir la RAÍZ del repo como estático con COOP/COEP (para SAB + numThreads>1,
#    igual que producción en Vercel). Ejemplo:
#    python3 -m http.server 8080  → crossOriginIsolated=false → numThreads=1 (GH Pages)
#    Con cabeceras Cross-Origin-Opener-Policy: same-origin y
#    Cross-Origin-Embedder-Policy: require-corp → numThreads=min(4, cores) (Vercel)
bunx serve .   # o cualquier servidor estático desde la raíz

# 5. Abrir el banco
#    http://localhost:PORT/tools/bench-rec-int8/bench.html

# 6. Leer resultados: tabla en pantalla + botón manual «DESCARGAR JSON»
#    (nada automático). El JSON trae hardware, navegador, numThreads, corpus,
#    fp32/int8 (msTotal, msPorLinea, confMedia), comparación (pctTextoIdéntico,
#    deltaConf) y veredicto GO/NO-GO según los umbrales de arriba.
```

## Qué mide y cómo (protocolo)

1. **EP idéntico a producción** (`src/lib/e14/ocr/rapidocr.ts:105`): `executionProviders: ["wasm"]`,
   `wasmPaths` → `public/vendor/onnxruntime/`, `simd: true`,
   `numThreads = min(4, cores)` solo con SAB + `crossOriginIsolated` (si no → 1, como GH Pages).
   El banco **NO** usa otro EP (prohibido webgpu/wasi — medir otra cosa no sirve).
2. **Corpus sintético determinista:** 60 líneas estilo acta dibujadas con canvas 2D
   (números largos, FECHA/HORA, PUESTO, TRANSMISION, MESA, códigos; 3 fuentes monospace,
   tamaños 28-44 px sobre blanco). Seed fija → MISMAS imágenes y MISMO orden para ambos
   modelos. Sintético 100%: cero fotos reales (kit §0.7).
3. **Pre/post idénticos al motor:** lote de 6 ordenado por ratio w/h
   (`rapidocr.ts:734-761`), `W = floor(48 · max(320/48, ratios))`, tensor NCHW con resize
   punto-fijo a h=48 + pad de ceros, canales **BGR**, normalización `(x/255 − 0.5)/0.5`,
   CTC greedy con `ppocr_keys.txt` y conf = media de probs de tokens seleccionados.
4. **Protocolo:** por cada modelo, pasada 1 caliente (descartada) y pasada 2 medida
   (incluye creación de tensor + `run` + decode, igual que el `msRec` del motor).
   Comparación texto-a-texto línea a línea en el mismo orden.

### Nota sobre "normalizado 0-1" del kit §3-T2.4

El kit decía «tensor NCHW normalizado 0-1», pero el **mandato principal** es «pre/post
idénticos al motor de producción» — y el motor normaliza con `(x/255 − 0.5)/0.5` (rango
[-1, 1], canales BGR; `rapidocr.ts:494-497`). El banco replica **el motor**, que es lo que
hace la medición válida.

## Desviación documentada de T1 (kit §0.4 y §3-T2.7)

1. **Paso previo oficial de ORT obligatorio.** El script literal del kit
   (`quantize_dynamic` directo) falla con este export Paddle2ONNX:
   `ValueError: Expected conv2d_157.w_0 to be an initializer` (los pesos llegan
   como nodos `Constant`, no initializers). `cuantizar.py` integra
   `onnxruntime.quantization.preprocess` (recomendado por el propio warning de
   la herramienta) con `--skip_symbolic_shape` (el shape inference simbólico
   aborta con "Incomplete symbolic shape inference" con este modelo).
2. **QInt8 → QUInt8 (fallback explícito del kit §3-T2.7).** Con
   `QuantType.QInt8` (lo pedido por el kit) el modelo cuantizado produce
   **salida degenerada**: texto vacío y conf 0.0000 en TODAS las líneas —
   verificado por partida doble con el preprocess idéntico al motor:
   - CPU EP (onnxruntime 1.31.0, python): fp32 lee
     `PUESTO 15565 MUNICIPI0 809 DEPARTAMENT0 90` (conf 0.9660) y QInt8
     devuelve `''` (conf 0.0000).
   - EP wasm del banco (ort-web 1.30.0): idéntico comportamiento (0/60 líneas
     con texto, conf media 0).
   NO es un bug del banco ni del EP: es el artifact QInt8. Con
   `QuantType.QUInt8` el modelo SÍ decodifica texto correcto (misma línea,
   conf 0.7911), y por eso el artifact final del banco es QUInt8. Evidencia
   completa en `docs/REPORTE-e14-bench-rec-int8-v1.md`.

Cero impacto en el banco: el fp32 del banco es el original intacto.

## Advertencias

- **Los números varían por máquina.** Los que deciden son los del dueño
  (4 núcleos / 8 GB / Chrome — la máquina donde corre producción).
- Si la sesión int8 no se crea en EP wasm (op no soportado, p. ej. `MatMulInteger`), el
  banco lo captura, muestra el error EXACTO y sigue como baseline fp32-only
  (`verdicto: "BLOQUEADA"`). Intentar regenerar el artifact con `QuantType.QUInt8` y
  repetir; si también falla, es un hallazgo válido: int8 no viable en EP wasm hoy.
- **Nota experimental (ya aplicada):** QInt8 crea sesión sin error PERO produce salida
  degenerada (texto vacío, conf 0) tanto en wasm EP como en CPU EP. El artifact final usa
  QUInt8 (fallback §3-T2.7). Si en el futuro se regenera con otro `weight_type`, editar
  la línea `quantize_dynamic(...)` de `cuantizar.py`.
- El banco omite `ort.env.wasm.proxy` (el motor lo usa para no bloquear el main thread);
  no afecta a las cifras — solo a quién ejecuta la inferencia.
- El umbral de aceptación del motor (`TEXT_SCORE = 0.5`) se reporta como
  `lineasAceptadasTEXT05` (informativo); la comparación de texto se hace sobre las 60
  líneas sin filtrar, igual para ambos modelos.
