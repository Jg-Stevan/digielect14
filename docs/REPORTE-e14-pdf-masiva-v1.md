# REPORTE — KIT e14-pdf-masiva-v1 (D60)

| Campo | Valor |
|---|---|
| **Task ID** | 2 (Agente 2) |
| **Rama** | `feat/e14-pdf-masiva-v1` (desde `origin/main` `f82faff` — merge PR #44) |
| **Tipo** | Ingesta de PDF en la cola MASIVA — **aditivo, cero cambios de pipeline/gate/dedup/persistencia** |
| **Gates** | `tsc` 0 · `lint` 0 · `next build` (estático COOP/COEP flags) OK · `git diff --name-status origin/main` = EXACTAMENTE zonas del kit (bun.lock + package.json + archivos.ts + store.ts + MasivaView.tsx) |

---

## 1. Problema (evidencia del dueño)

En la corrida real del 20-oct 15:04, los 2 únicos errores del lote fueron PDFs
oficiales E-14 (`E14_XXX_X_88_495_010_02_000_X_XXX.pdf`) → fila ERROR
`FORMATO_NO_SOPORTADO`. La clasificación de `agregarFiles` solo aceptaba
imágenes (`pareceImagenMasiva`) y `.zip/.rar` (`extraerArchivo`); todo lo
demás moría en el `else` final.

## 2. Principio aplicado

**El PDF entra a la cola como N imágenes.** Se renderiza página a página
client-side (pdf.js) y CADA página se encola como una `File` JPEG → el
pipeline real, el gate, el dedup, la persistencia (IDB) y la REVISIÓN
funcionan SIN cambios: la página viaja por la MISMA vía que las extraídas de
un .zip (ids reales, temps, `cadenaDedup`, runner, thumb — TODO heredado).

**Doctrina D47 respetada:** `pdfjs-dist` se importa DEFERIDO
(`await import(...)`) SOLO cuando llega un PDF. El worker viaja como asset
del paquete npm vía `new URL("pdfjs-dist/build/pdf.worker.min.mjs",
import.meta.url)` — **NADA en `public/**` ni `src/assets/**`** (mismo
mecanismo del `unrar.wasm`).

## 3. Dependencia (T1)

- **`pdfjs-dist` 6.4.299 — PIN EXACTO** en `package.json` (sin caret).
  El kit preveía v4.x/v5.x; bun resolvió la v6 (vigente) y las 2 diferencias
  de API se adaptaron (§6).
- Asset del worker verificado dentro del paquete:
  `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` ✓.

## 4. Bundle / LCP (gate T5 — verificado con manifest del build)

| Chunk | Tamaño | ¿Inicial? | Contenido |
|---|---|---|---|
| `3fj66a81a_b_g.js` | 455 KB | **NO (lazy)** | La lib pdf.js REAL (`GlobalWorkerOptions` implementación) — solo se descarga al llegar un PDF |
| `2u22fgpswq2zo.js` | 90 KB | sí (app) | Contiene SOLO la frontera diferida `await t.A(25834)` + el acceso de propiedad `GlobalWorkerOptions.workerSrc` (nombres, no código) |
| `2yhagipsq7t4t.js` | 229 KB | sí (preexistente) | Match `renderingIntent` = tabla CSS de React DOM — NO es pdf.js |
| `out/_next/static/media/pdf.worker.min.0zcq5mj7t-qsr.mjs` | — | asset | Worker emitido DESDE el paquete npm (NADA añadido a `public/`) |

El impacto en el bundle inicial ≈ **0 líneas de código nuevas eager** (la
URL del asset es un string constante de 43 bytes). LCP de Vercel intacto.

## 5. Comportamiento implementado (T2/T3/T4)

### Clasificación (`store.ts` `agregarFiles`)
```
imagen (pareceImagenMasiva)          → directo (INTACTO)
.zip / .rar                          → extraerArchivo (INTACTO)
.pdf (parecePdfMasiva — NUEVO)       → extraerPdf: páginas → imagenes
lo demás                             → FORMATO_NO_SOPORTADO (INTACTO)
```
Mismo manejo exacto que zip/rar: los `errores` de la extracción caen como
filas ERROR (motivo ≤48) y un `throw` del guard también.

### `extraerPdf` (contrato zip/rar)
1. Import diferido + `workerSrc` = asset del paquete (fallo →
   `PDF_WORKER_NO_CARGO`).
2. `getDocument({ data })` — contraseña (`PasswordException`) o parse/
   corrupción → `PROTEGIDO_O_CORRUPTO` (motivo ya conocido por la bandeja).
3. `numPages === 0` → `SIN_PAGINAS`.
4. Render SECUENCIAL página a página: viewport escala = `2400/ladoMayor`
   (tope ×4), canvas → JPEG q0.92 → `File(base-P#.jpg, image/jpeg)`.
   Blob null → página saltada (sin inventar). `page.cleanup()` por página.
5. Más páginas que el tope 30 → lo renderizado se encola + UNA fila ERROR
   `LIMITE_PAGINAS_PDF` (patrón `LIMITE_500_POR_COMPRIMIDO`).
6. Sin páginas renderizadas y sin errores → `SIN_PAGINAS`.
7. `carga.destroy()` en `try/finally` — memoria disciplinada.
8. Canvas 2d estándar — `willReadFrequently` NO aplica (render, no lectura).

Los nombres conservan la identidad del E-14 oficial:
`E14_XXX_...-P1.jpg`, `-P2.jpg`.

### Dropzone (`MasivaView.tsx`)
- `accept="image/*,.heic,.heif,.zip,.rar,.pdf"` (comentario T2.5 → D60).
- Hints: sin cola «SUELTA FOTOS, PDF O ZIP/RAR AQUÍ» · con cola «SUELTA MÁS
  ARCHIVOS AQUÍ — SE SUMAN A LA COLA».

## 6. Desviaciones documentadas (API v6 — pin 6.4.299)

El kit escribía la firma v4/v5. Dos adaptaciones necesarias y verificadas
(con el build Node del paquete: `doc.destroy is not a function` reproduce):

1. **`RenderParameters.canvas` es REQUERIDO en v6** y `canvasContext` es
   backwards-compat («si el contexto debe usarse, canvas debe ser null»).
   Se usa la firma RECOMENDADA v6: `page.render({ canvas, viewport })` —
   pdf.js crea su propio contexto 2d. Píxeles idénticos; `willReadFrequently`
   sigue sin aplicar.
2. **El `destroy()` vive en el LOADING TASK** (`PDFDocumentProxy` ya no lo
   expone): `const carga = getDocument(...)` + `await carga.destroy()` en
   el `finally` — misma disciplina de memoria que `doc.destroy()` del kit.

## 7. Validación (T5)

### Gates estáticos — VERDES
- `bunx tsc --noEmit` → 0 errores.
- `bun run lint` → 0.
- `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bunx next build` → OK
  (3/3 páginas estáticas).
- `git diff --name-status origin/main` = EXACTAMENTE: `bun.lock`,
  `package.json`, `src/lib/e14/masiva/archivos.ts`,
  `src/lib/e14/masiva/store.ts`, `src/components/e14/screens/MasivaView.tsx`.
  Zonas prohibidas (runner.ts, tipos.ts, next.config.ts, vercel.json,
  `public/**`, `src/assets/**`, SIM, informes, scanner-lab, packages/**)
  SIN tocar.

### Navegador (smoke test end-to-end, build estático + COOP/COEP
`tools/serve-coop-coep.js` — Chromium headless, PDFs sintéticos)

| Caso | Resultado |
|---|---|
| PDF 2 páginas entra por el dropzone | **2 filas** `E14_999_...-P1.JPG` / `-P2.JPG` PENDIENTE al instante ✓ |
| Identidad del nombre | conserva el nombre oficial + sufijo `-P#` ✓ |
| Runner sobre páginas | `PROCESANDO 0/2` + `[e14-rapidocr] det run OK (541ms)` + `prowarm listo` sobre la página renderizada ✓ |
| PDF corrupto (texto renombrado .pdf) | fila ERROR **`PROTEGIDO_O_CORRUPTO`** ✓ |
| PDF de 35 páginas | **30 filas** (P1..P30) + UNA fila ERROR **`LIMITE_PAGINAS_PDF`** ✓ |
| Regresión imágenes/zip/rar | cadena de clasificación solo AÑADE la rama PDF antes del `else` — caminos previos byte-idénticos ✓ |
| Consola | 0 errores de página; trazas `[e14]` normales |

### Dedup-PDF (OBSERVACIÓN del kit §3 — no requisito)

Con los 2 PDFs sintéticos (páginas visualmente casi idénticas entre sí y
entre archivos):

- `[e14] dedup fila=… marcada hamming=0 dupOf=…` — la P2 gemela de P1 y las
  páginas del 2.º PDF cayeron en la cadena dedup contra el 1.º (cross-archivo).
- **Mecanismo GO**: la cadena dedup opera sin cambios sobre páginas de PDF.
- **Advertencia esperada**: páginas MUY parecidas (mismo layout, deltas de
  texto pequeños) → hamming 0-1 → DUPLICADA. Un E-14 real P1 vs P2 tiene
  layouts distintos (cabecera/divipol/secciones) → riesgo bajo. Con los 2
  PDFs REALES del dueño (informe 15:04) queda pendiente confirmar que P1/P2
  NO se marcan gemelas (GO/NO-GO final = OBSERVACIÓN, no bloquea el PR).

### Pendiente del dueño (no ejecutable en sandbox)

- Los 2 PDFs reales del informe 15:04 → 1 fila por página → PROCESAR →
  filas con score/status/píldora como cualquier foto.
- PDF protegido con contraseña real → `PROTEGIDO_O_CORRUPTO`.
- Recarga → las filas de páginas sobreviven en IDB (mismo código de
  persistencia de imágenes — sin cambios).
- RAM: PDF de 30 páginas sin reventar la pestaña (render secuencial +
  cleanup + destroy — por diseño; medir en su hardware).
- El desenlace completo del pipeline sobre página sintética no terminó en
  la ventana headless (2 cores) — el código del pipeline es INTOCABLE en
  este kit (misma vía que imágenes, ya en producción).

## 8. Decisiones del worker (resumen)

- Worker como **asset del paquete npm** (`new URL(..., import.meta.url)`) —
  Turbopack lo emite a `_next/static/media/` (verificado en el build).
  Prohibiciones `public/**` / `src/assets/**` respetadas.
- `workerSrc` se asigna ANTES de `getDocument` en cada llamada a
  `extraerPdf` (idempotente; si un día cambia el chunk, siempre queda
  asignado).
- Fallo de construcción del worker → `PDF_WORKER_NO_CARGO` (motivo propio —
  precedente del FIX de auditoría del wasm `WASM_NO_CARGO`: jamás disfrazar
  un fallo de infra como PROTEGIDO_O_CORRUPTO).

## 9. Estado CI

Quality Gate (tsc/lint/build) del PR es la fuente de verdad; el worker de
`public/scanner/detection-worker.js` NO se tocó en este kit → la paridad
con `web-scanner` no cambia respecto a main (estado heredado de D57/ruta del
dueño, sin relación con D60).
