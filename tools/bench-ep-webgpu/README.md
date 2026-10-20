# Banco EP WebGPU vs WASM — KIT e14-bench-tiempos-v1 B4 (SOLO banco, cero producción)

Instrumento de medición para el **GO preliminar** del EP WebGPU (el techo del hardware del dueño
— 4 núcleos — es WASM; WebGPU típicamente 5-10×). **Este banco NO cambia nada de producción**:
`src/`, `public/`, `package.json` y configuración quedan intactos; ningún default cambia aquí
(la activación con flag gradual + fallback wasm es un kit FUTURO con decisión del dueño).

- **GO preliminar (kit §4):** speedup ≥ **2×** + texto idéntico en dígitos/votos.
- **BLOQUEADA (entorno):** WebGPU no disponible → **NO es NO-GO del EP** — limitación del entorno;
  el dueño valida en SU Chrome 155 / Windows.

## Qué hay aquí

| Archivo | Rol |
|---|---|
| `bench.html` | Banco standalone con 3 brazos: `["webgpu","wasm"]` (ort.all + build jsep, fallback automático del EP array) · `["wasm"]` (ort.all + jsep — CONTROL del mismo build) · `["wasm"]` (ort.wasm + vendored — ANCLA de producción). Pipeline completo det→cls→rec réplica de `rapidocr.ts` (cap 1920, cls/rec lote 6). |

## Por qué 3 brazos (diseño del experimento)

- **webgpu vs control**: mismo módulo ORT (ort.all/jsep), solo cambia el EP → el speedup es
  atribuible al EP, no al build.
- **ancla de producción**: el build que usa el app (`ort.wasm.min.mjs` + wasmPaths vendido en
  `public/vendor/onnxruntime/`, byte-idéntico) fija los números contra producción.
- Los builds jsep NO están vendidos (T3 de optimizacion-v1 los sacó de `public/` — no se pueden
  tocar): el banco los carga desde `node_modules/onnxruntime-web/dist/` (local, gitignored).
  Desviación documentada del patrón bench-rec-int8 (que servía TODO vendido): aquí es imposible
  sin tocar `public/`.

## Cómo reproducir (pasos exactos)

```bash
bun install
# Servir la RAÍZ del repo con COOP/COEP (Cross-Origin-Opener-Policy: same-origin,
# Cross-Origin-Embedder-Policy: require-corp) → numThreads=min(4,cores) como Vercel.
# Abrir: http://localhost:8099/tools/bench-ep-webgpu/bench.html
# Botón «DESCARGAR JSON» manual (§0.2). window.__benchJson = lectura programática.
```

En el Chrome del dueño (Windows, GPU real): abrir `chrome://flags` NO es necesario —
WebGPU está activo por defecto en Chrome 113+; el banco detecta `navigator.gpu` +
`requestAdapter()` y reporta vendor/arquitectura del adapter.

## Qué mide y cómo (protocolo)

1. **Corpus acta-like sintético determinista** (seed `0xe14e9c01`): 2 páginas tira E-14
   1000×2920 con 30 votos manuscritos cada una (mismo generador que bench-det1280, otra seed).
2. **Métricas por brazo:** ms det/cls/rec/total por página, nº cajas, líneas, votos leídos
   (regex `\bvalor\b` sobre `norm()`), anclas (copia congelada de las 10 regex), conf media.
3. **Paridad:** texto normalizado idéntico entre brazos por página + votos idénticos + Δconf.
4. **Protocolo:** por cada brazo, pasada caliente descartada + pasada medida. **Determinismo:** ×2
   («REPETIR CORRIDA») — métricas de texto EXACTAS, ms dentro de ±10%.

## Veredicto medido (ver REPORTE para la evidencia completa)

**BLOQUEADA (entorno)** — `navigator.gpu` existe en HeadlessChrome 155 pero `requestAdapter()`
devuelve `null` (sin GPU/adapter en el headless del sandbox). NO es NO-GO del EP (kit §4).
Hallazgo de valor del banco: **paridad byte-idéntica entre builds wasm** — control jsep vs ancla
de producción producen texto/conf EXACTOS (30/30 votos, 10/10 anclas, conf 0.9935/0.9932 en ambas
páginas, en las 3 corridas) — confirma que el build jsep es el mismo motor y que el banco está
calibrado. El dueño corre este banco en SU Chrome 155/Windows: si ≥2× + texto idéntico → GO
preliminar → kit de activación (flag gradual + fallback wasm) con su decisión.
