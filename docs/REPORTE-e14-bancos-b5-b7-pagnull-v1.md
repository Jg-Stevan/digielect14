# REPORTE — KIT e14-bancos-b5-b7-pagnull-v1 (D58) — SOLO EVIDENCIA, CERO PRODUCCIÓN

**Rama:** `bench/e14-bancos-b5-b7-pagnull-v1` (desde main `f9e4027`) · **PR:** DRAFT (título con D58) · **Fecha:** 2026-10-20
**Zonas tocadas:** `tools/bench-det960/**` + `tools/bench-dedup-tolerancia/**` + `tools/serve-coop-coep.js` (infra compartida de bancos) + `tools/assets/` (vacío, `.gitignore` para las fotos del dueño) + `docs/*` (append-only). **`src/**` y `public/**`: 0 diff** (gate §4 — `git diff --name-status main` = solo `tools/` + `docs/`).
**Contexto:** informe del dueño 20/10 07:42 — 17 actas, 17 ENVIADAS, 0 rechazos (cascada viva) con 3 hallazgos: (1) dedup no atrapó 2 pares heic/jpg (171454: 27.0 s vs 16.8 s · 171446: 37.6 s vs 16.6 s — ambos a pipeline completo), (2) OCR media 5.4 s con pasada 1 a 1280 → ¿puede la pasada 1 ir a 960?, (3) `171446` se ENVIÓ con `paginaIndex = null` (gate completa, score 8.5).

---

## 1. Banco B5 — det a 960 vs 1280 vs 1920 (`tools/bench-det960/`)

**Instrumento:** réplica del patrón `tools/bench-det1280` (PR #34 — b3 GO): pre-det op1-4 + DB-postprocess JS puro mapeado a espacio fuente, MISMA sesión det compartida entre los 3 caps (solo cambia op4 — `DET_CAP`), MISMO corpus sintético determinista (seed `0xe14de7a2`, 4 páginas acta-like 1000×2920 con 30 votos manuscritos cada una). Criterio del kit: **caja perdida = caja a 1920 sin match a 960/1280 con IoU ≥ 0.5 entre quads** (IoU medido entre los AABB de los quads mapeados a la fuente — proxy determinista, conservador; documentado en el README del banco). Det SOLAMENTE (el criterio B5 es de cajas).

**Resultados (sandbox 2 núcleos, HeadlessChrome, EP wasm vendido, numThreads=2, COI=true) — determinismo ×2 idéntico:**

| acta | límite | nCajas | cajasPerdidas vs 1920 | ms |
|---|---|---|---|---|
| sintetica-p1 | 1920 (ref) | 71 | — | 686.6 |
| sintetica-p1 | 1280 | 71 | **0** | 304.2 |
| sintetica-p1 | 960 | 71 | **1** | 198.6 |
| sintetica-p2 | 1920 (ref) | 71 | — | 693.5 |
| sintetica-p2 | 1280 | 71 | **0** | 316.3 |
| sintetica-p2 | 960 | 71 | **1** | 193.1 |
| sintetica-p3 | 1920 (ref) | 71 | — | 714.2 |
| sintetica-p3 | 1280 | 71 | **0** | 341.9 |
| sintetica-p3 | 960 | 71 | **2** | 193.7 |
| sintetica-p4 | 1920 (ref) | 71 | — | 693.5 |
| sintetica-p4 | 1280 | 71 | **0** | 311.6 |
| sintetica-p4 | 960 | 71 | **1** | 190.7 |

- Σ det ms: **1920=2787.8 · 1280=1274.1 · 960=776.1** (960 ≈ 0.28× de 1920; teoría (960/1920)² = 0.25).
- Cross-validación de la réplica: **71 cajas/página a 1920 y a 1280 = EXACTAMENTE lo medido por el banco det1280 del PR #34** (71/71, GO).
- Outputs completos: `tools/bench-det960/resultados/bench-det960-resultado.{json,md}`.

**VEREDICTO B5: NO-GO (duro).** 960 pierde cajas en las 4/4 páginas (5 totales; 1+1+2+1) → el criterio del kit («si pierde UNA caja → NO-GO documentado») condena la pasada 1 a 960. **D60 queda SIN evidencia GO: la palanca de 1.ª pasada se mantiene en 1280 (D53).** El ahorro marginal 1280→960 (~0.2× del det ≈ 0.1-0.2 s/acta) no justifica el riesgo medido de pérdida de cajas.

**Pendiente del dueño:** correr el banco con sus 9 fotos reales (171125, 170755, 171446, 171454, 171500, 171506, 171512, 171518 en jpg y/o heic) — botón «AÑADIR FOTOS REALES» (locales, NUNCA se commitean — `tools/assets/.gitignore`). Con UNA caja perdida en una sola foto real el NO-GO queda cerrado por la vía física también.

---

## 2. Banco B7 — tolerancia dedup heic/jpg (`tools/bench-dedup-tolerancia/`)

**Instrumento:** dhash 64-bit **copia congelada de `src/lib/e14/masiva/dedup.ts` L16-74** (canvas 9×8, grises 0.299/0.587/0.114, gradiente horizontal, hex 16; `hamming64` y `HAMMING_MAX=6` verbatim — kit T2: «NO reimplementes un dhash distinto») sobre la **MISMA vía del pipeline de producción**: `fileToCaptureDataUrl` importado directamente de `node_modules/@jg-stevan/scanner-core/dist/image-processor.js` (EXIF/12MP/HEIC — byte-idéntico a la app; wrapper ESM solo-banco para el `import("heic2any")` bare del core + shim `process.env.NEXT_PUBLIC_BASE_PATH` — ver §4 desviaciones) → `hacerThumb` 320 (copia congelada de `runner.ts` L64-87) → dhash.

**a) Mecanismo (corpus sintético, gemelas POR CONSTRUCCIÓN — mismo píxel-set codificado en png / jpg-q92 / jpg-q50):**

| par | a | b | hamming | ≤ 6 (el dedup la atraparía)? |
|---|---|---|---|---|
| sintetica-1 | png | jpg-q92 | 0 | SÍ |
| sintetica-1 | png | jpg-q50 | 2 | SÍ |
| sintetica-1 | jpg-q92 | jpg-q50 | 2 | SÍ |
| sintetica-2 | png | jpg-q92 | 0 | SÍ |
| sintetica-2 | png | jpg-q50 | 1 | SÍ |
| sintetica-2 | jpg-q92 | jpg-q50 | 1 | SÍ |
| sintetica-3 | png | jpg-q92 | 0 | SÍ |
| sintetica-3 | png | jpg-q50 | 5 | SÍ |
| sintetica-3 | jpg-q92 | jpg-q50 | 5 | SÍ |

maxIntraPar = **5** (≤ 6 ✓) · minEntreActas = **4** (¡< 6! — ver hallazgo colateral).

**b) Sensibilidad al color (hipótesis del dueño: el decode HEIC→RGB difiere del JPG→RGB en gamma/color y el hash se escapa):**

| δ canal R (G+0.7δ, B+0.4δ) | +1 | +2 | +3 | +5 | +8 | +12 |
|---|---|---|---|---|---|---|
| hamming vs base | 2 | 2 | 2 | 2 | 2 | 3 |

**Lectura:** el dhash es ROBUSTO a shifts de color grandes (+12/8/4 por canal solo mueven 2-3 bits — los gradientes horizontales sobreviven). La hipótesis «gamma/color» queda **DEBILITADA** como causa del escape: haría falta una diferencia de decode ESTRUCTURAL (demosaica distinto, crop distinto, rotación EXIF distinta entre el jpg y el heic) para superar 6 — eso solo se decide con las fotos reales del dueño.

**c) Hallazgo colateral (observación para D61 — NO es la pregunta del kit pero la evidencia la arrojó):** `minHammingEntreActas = 4 < umbral 6` en el sintético: actas con el MISMO layout (plantilla E-14, misma grilla, misma tipografía) y DATOS distintos pueden caer DENTRO del umbral → riesgo teórico de FALSO POSITIVO del dedup (marcar una acta distinta como gemela y copiar el desenlace de la otra). El corpus real decide la tasa; la forma del hash (p. ej. comparar también la banda del código 1D) es OTRO kit (D61). El botón «PROCESAR IGUAL» + el fallback honesto siguen siendo la red de seguridad.

**d) Hipótesis ORDEN (kit T2 — alternativa al hash):** la caída a pipeline completo de AMBOS componentes de cada par (27.0+16.8 s · 37.6+16.6 s) es consistente con la carrera documentada EN CÓDIGO:

- `store.ts` L174-175: `cadenaDedup` solo marca la gemela si aún está **PENDIENTE** (si el runner la tomó antes → no se marca).
- `store.ts` L167-170: la cadena es FIFO por `agregadaEn` — la original siempre lleva delante, PERO el hash de la original requiere SU decode completo (~1-2 s en HEIC) antes de que el hash de la gemela pueda comparar contra él.
- `runner.ts` L128: `reutilizarResultado` devuelve `false` si el registro de la original aún no tiene acta (`!actaOrigen` — original EN PROCESO o ERROR).
- `runner.ts` L180-188: en ese caso la fila se des-marca y reprocesa COMPLETO con traza **`[e14] dedup fila=<id> sin-original reprocesa-completo`**.

**Trazas que deciden la causa (buscar en las capturas del dueño si existen):**

```text
[e14] dedup fila=<id> marcada hamming=<d> dupOf=<origen> hash=<hex>   ← se marcó (store.ts L180)
[e14] dedup fila=<id> dupOf=<origen> reutiliza score=<s> ms=<ms>      ← copia OK (runner.ts L142)
[e14] dedup fila=<id> sin-original reprocesa-completo                 ← carrera de ORDEN (runner.ts L188)
```

- Si NO hay traza `marcada` para 171454/171446 → el hash NO los emparejó (distancia > 6 — causa hash/estructura del decode; las fotos reales en el banco la miden).
- Si hay `marcada` + `sin-original` → causa ORDEN (carrera encolado; el fix sería un re-intento diferido en el runner — otro kit).

**VEREDICTO B7: INCONCLUSO POR DISEÑO con evidencia fuerte de mecanismo.** El mecanismo atrapa gemelas de mismo-píxel-set (maxIntra 5 ≤ 6) y el color NO parece la causa; la decisión D61 (tolerancia/forma del dhash) queda bloqueada por las **fotos reales del dueño** (pares .heic+.jpg de 171454 y 171446 en el banco — «CARGAR FOTOS REALES» → «CALCULAR DHASH DE LAS REALES») **o** por las trazas de consola de la jornada (hipótesis ORDEN). El kit explícitamente prohíbe cambiar el umbral aquí.

---

## 3. Forense pag=None — acta 171446 (ENVIADA, score 8.5, `paginaIndex: null`)

**Cadena causal completa trazada en el código (todas las citas @ main f9e4027):**

1. **¿Cómo queda `pagina` null?** `clasificador.ts` L533-560: la página sale de (1) la línea impresa «Ver/Pag/de» (`ANCLA_VERPAG` L145) → si no, (2) el CONSENSO del código 1D (L545-555 — todos los parseados acuerdan) → si no, (3) el respaldo `paginaDesdeCodigo1D` (L557-559). **Ninguna cuadra → `pagina: null`** (comentario L528: «página DESCONOCIDA»). Con null el aviso de código inconsistente puede coexistir (`CODIGO_1D_INCONSISTENTE` L519).

2. **¿Cómo llegó a score 8.5 con gate completa?** `scanner-core-bridge.ts` L1377-1381: lectura **FUERTE** → `score = Math.max(score, PISO_LECTURA_FUERTE)` (`senal-lectura.ts` L35 = **8.5**). El score EXACTO 8.5 del informe = el piso de lectura FUERTE. Caps que NO aplicaron: escudo de fondo (L1425-1427, techo 7.9 — no hubo franja oscura al filo), recortada (L1462-1464, techo 7.9 — no hubo secciones faltantes), DEBIL (L1382-1383, techo 5.9 — la lectura fue FUERTE).

3. **El gate NO mira la página:** marcadores de votos L1417-1421 — `votosSkipPag2 = clasificacion.pagina?.index === 2` → con null es `false` → la zona de votos **se mide** (conservador, comentario L1416-1418) → `marcadoresOk=true`. `evaluarGate` L2244-2281: score ≥ 6.5 + `clasificacion.nivel === "AUTO"` → `status = statusDeScore(score)` → **`types.ts` L228-230: 8.5 ≥ 8 → OPTIMA → auto-envío** (runner masiva `runner.ts` L232-245 / flujo `store.ts` L818). **Ninguna condición del gate/auto-envío involucra `paginaIndex`.**

4. **¿Sabe el receptor qué página recibió? NO — en DOS capas:**
   - **Transmisión (título):** `store.ts` L536-543 `tituloDeActa` — con clasificación AUTO y `pagina == null` el título lleva **«PÁG ?»** (L539). El hash del envío es `hashMock()` (L475) — la transmisión REAL (módulo de SUPERVISIÓN) no existe aún (pendiente del dueño): hoy el «receptor» es el consolidado local de la app.
   - **Consolidado (archivado del hueco):** `store.ts` L377-393 `archivarHueco` — con `clasif.pagina == null` el hueco va al **PRIMER hueco LIBRE** del tipo (P1 libre → P1 · si no P2 → P2 · si no P1, que REEMPLAZA — L384-393). Decisión documentada del kit actas-vivas-paginas-v1 (no es bug): NUNCA se asume P1 en silencio, pero el consolidado **ATRIBUYE una página que el acta nunca declaró**.

5. **Riesgo de integridad (concreto):** si la página REAL de 171446 era 2 y P1 estaba libre (o la mesa no tenía huecos aún), el acta se archiva como **P1** → el consolidado marca ese hueco OK con datos de otra página; cuando llegue la P1 REAL, el reemplazo por duplicado (L409-421) pisa la clasificación → **los datos de la pág-2 real quedan FUERA del consolidado** (enviada sí, archivada en el hueco equivocado, luego reemplazada). En una mesa de 2 páginas el consolidado puede cerrar «completo» con una página nunca consolidada en su hueco correcto.

6. **Hipótesis de la causa (elegidas con el código, no especulación):**
   - **(a) Acta de NIVELACIÓN** (hoja aparte del KIT): sin línea «Ver/Pag/de» Y sin código 1D parseable → ambas fuentes null. CONSISTENTE con el código y con score 8.5.
   - **(b) Formato de tira no reconocido / letra pequeña ilegible:** `ANCLA_VERPAG` (L145) exige el literal «Ver…Pag…de» con dígitos — variantes tipográficas que no casen → null; y el código 1D (15 dígitos OCR-B pequeños bajo la banda KIT) ilegible o inconsistente → null. CONSISTENTE: la lectura FUERTE con 8.5 requiere `mesaLeida && anclas ≥ 4` (`senal-lectura.ts`) y las anclas que NO se leyeron serían exactamente las dos pequeñas (Ver-Pag y código 15d) — las gruesas (E-14, REGISTRADURÍA, CONSULADO/PAÍS, ZONA, PUESTO, MESA, KIT) alcanzan de sobra.
   - **(c) Foto parcial: DESCARTADA por evidencia** — un recorte parcial activa el techo `recortada` 7.9 (L1462-1464) o el escudo de fondo 7.9 (L1425-1427): con score EXACTO 8.5 NINGUNO cap aplicó → la foto estaba entera y bien leída.

7. **Propuesta de fix (kit futuro D62 — NO implementado aquí):** (i) corto plazo: si `pagina == null` con gate completa y AUTO, ABJAR el auto-envío a ADVERTENCIA (techo 7.9 patrón D10) hasta que el receptor sepa la página — decisión del dueño, tiene costo en la tasa de auto-envío; (ii) o mantener auto-envío pero MARCAR la fila en el receptor como «PÁG ?» y archivarla en un hueco DEDICADO «página desconocida» (no primeros-libres) hasta confirmación humana; (iii) largo plazo: módulo de SUPERVISIÓN con página explícita en la transmisión. Cada opción es otro kit.

---

## 4. Desviaciones y notas honestas

1. **Corpus:** la evidencia dura de B5/B7 es con corpus SINTÉTICO (mismo generador/seed del banco det1280 — 0 fotos del dueño commiteadas, gates §4). La validación física con las 9 fotos reales del dueño es la que cierra B5 (NO-GO ya casi cerrado: pierde en 4/4 páginas) y DECIDE B7 (pendiente). El banco B5/B7 ya acepta fotos reales por input local.
2. **IoU como AABB** (B5): el kit pide «IoU ≥ 0.5 entre quads»; se mide entre los AABB de los quads mapeados a fuente (proxy determinista, conservador — documentado en el README del banco). Los quads del mismo texto a distinto cap mapean casi idéntico; un match falso requeriría IoU AABB < 0.5 con solape real > 0.5 (geometría improbable para quads casi idénticos).
3. **Infra del banco:** `tools/serve-coop-coep.js` (NUEVO, compartido): servidor estático COOP/COEP con fallback extensionless para los imports bundler-style del core (`from "./types"` → `/types.js` — el navegador crudo no los resuelve; en la app los resuelve el bundler). Y en B7: wrapper ESM de `heic2any` (el core hace `import("heic2any")` bare) + shim `window.process.env.NEXT_PUBLIC_BASE_PATH` (detector-client.js del core lo lee). Todo SOLO-BANCO, fuera de `src/` y `public/`.
4. **Tiempos del sandbox ≠ del dueño:** los ms absolutos (2 núcleos headless) valen para RATIOS; las decisiones del kit son de cajas y hamming (deterministas ×2 verificado en B5).
5. **`docs/AGENTS.md` no existe** (el kit decía «Lee docs/AGENTS.md»): las reglas viven en `AGENTS.md` (raíz) — leídas y respetadas.

## 5. Cómo reproducir

```bash
bun install
bun run tools/serve-coop-coep.js 8123          # raíz del repo, COOP/COEP + fallback extensionless
# B5:  http://localhost:8123/tools/bench-det960/bench.html            (REPETIR CORRIDA ×2)
# B7:  http://localhost:8123/tools/bench-dedup-tolerancia/bench.html  (CORRER SINTÉTICO; luego fotos reales del dueño)
# Outputs: botones «DESCARGAR JSON/MD» → resultados/ de cada banco (window.__benchJson programático).
```

## 6. Nota de continuidad de sesión

El agente se ejecuta en un sandbox con reinicios: el clon de trabajo es **`/home/z/digielect14`** (rama `bench/e14-bancos-b5-b7-pagnull-v1`), el kit vive en `/home/z/my-project/upload/AGENTE-3-D58-bancos-evidencia.md`, el worklog del agente en `/home/z/my-project/worklog.md` (Task ID 3). Tras un reinicio: re-clonar con el token que entrega el dueño, leer este reporte + `docs/worklog.md` y continuar por la sección de «pendiente del dueño» correspondiente. **El dueño debe REVOCAR el token al cerrar la jornada** (quedó expuesto en el chat).
