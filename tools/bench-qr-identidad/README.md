# Banco QR identidad — KIT banco-qr-identidad-v1 (SOLO EVIDENCIA, CERO PRODUCCIÓN)

Instrumento de medición para decidir la **identidad pre-OCR por QR** (futuro kit e63m) contra la
apuesta dhash del e63h: las gemelas re-comprimidas se ESCAPAN del umbral `HAMMING_MAX=6`
(q50 → hamming 8-9) mientras actas distintas del mismo layout quedan DENTRO (5) — **ningún
valor del umbral separa las poblaciones** (evidencia FASE 0 e63h, Tasks 16-18). El QR de la
E-14 decodifica 9/9 en sandbox (jsQR, banda top-left): payload = Base64 de 32 bytes, distinto
por página. **Este banco NO cambia nada de producción**: `src/`, `public/`, `package.json`,
`bun.lock` quedan intactos (`git diff --name-status main` = SOLO `tools/bench-qr-identidad/**` + `docs/**`).

## Qué hay aquí

| Archivo | Rol |
|---|---|
| `bench.html` | Banco standalone (patrón D58 del bench-dedup-tolerancia): vía de entrada de PRODUCCIÓN (`fileToCaptureDataUrl` del core — EXIF/12MP/HEIC) → canvas de trabajo lado largo **≤ 2048 px** → intentos de decode jsQR A/B/C/C×1.5 con `{inversionAttempts:"attemptBoth"}` → agrupación por **igualdad EXACTA de payload** (sin umbrales) → export JSON/MD. |
| `jsQR.js` | **Vendido**: jsQR@1.4.0 (`npm tarball dist/jsQR.js`, UMD webpack, MIT, cero deps). BarcodeDetector nativo PROHIBIDO por el kit §5 (determinismo entre máquinas). |
| `heic2any-esm.js` | Wrapper ESM del UMD de heic2any — SOLO banco: el core hace `import("heic2any")` (bare specifier) y el navegador lo resuelve vía import map. Copia byte-idéntica del bench-dedup-tolerancia. |
| `resultados/` | Outputs JSON+MD de las corridas (la evidencia). Las FOTOS del corpus NUNCA se commitean. |

## Por qué canvas ≤ 2048 y NO el thumb 320 del dhash

El thumb de 320 px del dedup (`hacerThumb` — copia de `runner.ts`) es **DEMASIADO PEQUEÑO
para el QR**: a esa escala cada módulo del QR cae por debajo del píxel y jsQR no tiene
estructura que binarizar. El banco usa lado largo **≤ 2048 px** (≈ resolución de trabajo de
foto re-escalada; la foto real midió 41 ms de decode a resolución completa — Tasks 16-18).
El tamaño de trabajo se registra por archivo (`trabajoAnchoAlto`).

## Intentos de decode (se registran TODOS)

| Intento | Banda (fracciones del canvas de trabajo) | Nota |
|---|---|---|
| **A** | imagen completa (100% × 100%) | |
| **B** | top-left 0-45% × 0-25% | banda gruesa donde vive el QR |
| **C** | 8-38% × 5-20% | posición observada en el fixture real (x≈12-32%, y≈8-17%) |
| **C×1.5** | misma banda de C up-escalada 1.5× | reintento si C falla |

Ganador = primer OK en orden A → B → C → C×1.5. Toggle **«probar rotaciones»** (default OFF):
en los primeros **6** archivos repite el mejor intento con el canvas rotado 90/180/270 —
jsQR maneja orientación nativa; esto lo **VERIFICA**, no lo asume.

## Grupos y colisiones (el output del dinero)

- **Grupos:** `Map<payload, archivos[]>` — archivos con payload IDÉNTICO se agrupan.
  **Sin umbrales de ningún tipo: agrupación = igualdad exacta de string** (el QR es dato
  leído — Reed-Solomon: decodifica exacto o falla).
- **Detector de colisión (NO-GO automático):** 2+ archivos con **stem de escaneo DISTINTO**
  (171XXX ≠ 171YYY) compartiendo payload → grupo marcado en rojo. Heurística documentada:
  re-encodes con nombres distintos (durazno/imagen) compartiendo payload es la tesis
  GANANDO, no colisión — el juicio final lo emite el dueño con la verdad de terreno (kit §4).

## Cómo correr (pasos exactos)

```bash
bun install   # solo para que exista node_modules/@jg-stevan/scanner-core (no se toca)
bun run tools/serve-coop-coep.js 8123
# Abrir: http://localhost:8123/tools/bench-qr-identidad/bench.html
# 1) «CARGAR FOTOS REALES» con el corpus completo EN UNA SOLA CARGA (kit §4):
#    12 re-fotos 20261021_16*.jpg · durazno1-8.heic + imagen1-10.jpg ·
#    escaneos 171500/171506/171512/171518/171446/171454 (+ gemelas) · fixture src/assets/acta-e14-real.jpg
# 2) (opcional) activar «probar rotaciones»
# 3) «PROCESAR» → tabla + grupos + resumen
# 4) «DESCARGAR JSON» / «DESCARGAR MD» → pegar al agente (criterio de GO del kit e63m, kit §4)
```

- Consola: trazas con prefijo `[e14-banco-qr]` (solo-aditivas).
- `window.__bancoQrJson` = último resultado (lectura programática).
- `window.__bancoQrCargarArchivos(File[])` = hook de QA/dev que inyecta archivos por la
  MISMA vía que el input (solo banco; 0 uso en producción).

## Fuera de alcance (kit §5)

NO implementa la capa e63m en producción · NO usa BarcodeDetector nativo · NO valida/firma
el payload (contenido opaco; solo igualdad exacta) · NO toca autoenvío/watchdog/cola masiva.

## Veredicto

La conclusión (¿el QR reemplaza al dhash para gemelas?) se emite en el kit e63m con los
números de `resultados/` (FASE 0 del dueño, kit §4: re-encodes que al dhash dieron 8-33
agrupan con sus gemelas ✅ · tasa ≥ ~70-80% ✅ · colisión ❌ NO-GO · escaneos ~100% ✅ bonus).
