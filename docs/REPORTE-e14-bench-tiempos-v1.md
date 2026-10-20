# REPORTE — KIT e14-bench-tiempos-v1 (AGENTE 3) — 3 bancos de medición de tiempo (CERO producción)

**Rama:** `bench/e14-tiempos-bancos-v1` desde `main @ b8b3e12` · **Fecha:** 2026-10-19/20 (Bogotá) · **Agente 3 (Z.ai Code)**
**Kit:** dividido del mega-kit `INSTRUCCIONES-e14-orientacion-tiempos-v1.md` (§3 B2 + B3 + B4) — trabajo paralelo con los otros 2 agentes.
**Mandato:** decidir CON DATOS las 3 palancas de tiempo restantes sin tocar producción. La producción de este PR está VACÍA (ver §8).
**Entorno de medición del agente:** HeadlessChrome 155 (`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36`) · 2 núcleos lógicos · COOP/COEP local → `crossOriginIsolated=true` → `numThreads=2` (paridad D46 con Vercel; GH Pages correría numThreads=1) · ort-web 1.30.0 EP wasm vendido byte-idéntico.

---

## §1 — VEREDICTOS (los 3, con criterio del kit)

| Palanca | Criterio del kit | Veredicto medido (este entorno) | GO/NO-GO |
|---|---|---|---|
| **B2 — lote rec/cls 6 → 12** | texto idéntico 100% + Δconf ≤ 0.5 + speedup ≥ 1.05× | rec: 98.33% idéntico ❌ · Δconf −0.172 ✓ · speedup **0.99×** ❌ — cls: flags 100% ✓ · speedup **1.25-1.30×** ✓ | **NO-GO (rec) · GO (cls)** → global **NO-GO** (decisión por sub-palanca es del dueño) |
| **B3 — det 1280 vs 1920** (GO/NO-GO DURO) | mismos votos leídos en TODO el corpus + FUERTE idénticas; UN voto perdido → NO-GO | **0 votos perdidos** (120/120) · FUERTE 4/4 idénticas · 10/10 anclas y 71/71 cajas por página en AMBOS caps · det **−56.4%** | **GO** (pendiente validación física con fotos reales del dueño, kit §4) |
| **B4 — EP WebGPU** | speedup ≥ 2× (preliminar) + texto idéntico en dígitos/votos | `requestAdapter()` → `null` en este headless → **BLOQUEADA (entorno)** — NO es NO-GO del EP (kit §4). Hallazgo de calibración: paridad EXACTA de texto/conf entre el build jsep y el build de producción | **BLOQUEADA (entorno)** — el dueño corre el banco en SU Chrome 155/Windows |

**Resumen ejecutivo:** la palanca que vale hoy es **B3** (det 1280: −56% del det con CERO daño de lectura en el corpus sintético — 120/120 votos, anclas y cajas idénticas). B2 rec muere (no acelera: 0.99×; y degrada 1 línea de 60 — `TESTIGO`→`TESTIG0`); si el dueño quisiera adoptar SOLO el cls (1.25-1.30×, flags idénticos), sería un kit aparte con su decisión. B4 no se puede decidir en este sandbox: falta la GPU del dueño.

---

## §2 — Banco 1 · `tools/bench-lote12/` — B2: lote 6 vs 12 (rec y cls)

**Protocolo:** corpus sintético determinista de 60 líneas estilo acta — el MISMO generador del kit bench-rec-int8 (seed `0xe14be6c5`, mismas plantillas/fuentes/tamaños) — MISMAS imágenes para los 2 lotes. EP wasm vendido. Por cada palanca: pasada caliente descartada + pasada medida. Sesiones rec/cls compartidas.

### rec (réplica exacta de rapidocr.ts:783-808 — orden por ratio, `W=floor(48·max(320/48,ratios))`)

| Métrica | lote 6 (producción) | lote 12 | Comparación |
|---|---|---|---|
| ms total (corrida 1) | 5208.7 | 5260.2 | — |
| ms/línea | **86.812** | **87.671** | speedup **0.990×** ❌ (≥1.05) |
| ms/línea (corrida 2) | 86.793 | 87.792 | speedup **0.989×** ❌ |
| runs de `session.run` | 10 | 5 | −5 llamadas (la hipótesis del kit) |
| conf media | 0.9761 | 0.9778 | Δconf **−0.172 pts** ✓ (≤0.5) |
| texto idéntico línea a línea | — | — | **98.33% (59/60)** ❌ (100%) |
| aceptadas (TEXT_SCORE 0.5) | 60/60 | 60/60 | — |
| % vs GT | 23.33% | 21.67% | la línea 26 cambia y pierde el GT |
| W máx del corpus | 762 | 762 | igual |
| tensor máx por run (float32) | 2.63 MiB | **5.27 MiB** | ×2 (kit estimaba [12,3,48,~320] ≈ 2.2 MB; aquí W llega a 762) |

**La línea divergente (única, corrida 1 = corrida 2, EXACTO):** `#26 · esperado "TESTIGO 51482 FIRMA 606299 25"` → lote 6: `"TESTIGO 51482 FIRMA 606299 25"` (conf 0.9771) · lote 12: `"TESTIG0 51482 FIRMA 606299 25"` (conf 0.9805) — **O→0**, el tipo de error que en un acta corrompe un dígito.

**Por qué NO acelera (lectura del dato):** doblar el lote sí quita 5 llamadas a `session.run`, pero el `W` del lote se fija por el ratio MÁXIMO de las 12 líneas (vs 6) — los tensores crecen y el costo total se mantiene o empeora. En 2 núcleos el overhead por-llamada es menor que el costo del tensor extra.

### cls (réplica exacta de rapidocr.ts:740-761 — orden de cajas tal cual, h=48 w≤192, p180>0.9)

| Métrica | lote 6 | lote 12 | Comparación |
|---|---|---|---|
| ms total (corrida 1) | 155.8 | 120.2 | — |
| ms/línea | 2.597 | 2.004 | speedup **1.296×** ✓ (≥1.05) |
| speedup (corrida 2) | — | — | **1.242×** ✓ |
| flags de rotación idénticos | — | — | **100% (60/60)** ✓ (rot ON = 0 en ambos) |
| tensor máx | 0.63 MiB | 1.27 MiB | ×2 (cls es barato: 155→120 ms) |

**Veredicto kit §2:** rec NO-GO (2 de 3 criterios fallan) · cls GO → **global NO-GO**. Si el dueño quisiera el cls solo, la palanca es real pero pequeña (cls ≈ 0.4-1.1% del OCR de un acta: 155 ms vs 18.6 s de rec en el corpus del banco 2).

---

## §3 — Banco 2 · `tools/bench-det1280/` — B3: det 1280 vs 1920 (GO/NO-GO DURO)

**Protocolo:** pipeline completo det→cls→rec réplica de `rapidocr.ts @ b8b3e12` con UNA diferencia local: op4 (det-preprocess) usa `DET_CAP` (1920 producción | 1280 candidato); op1 `reduce_max_side` 1920 INTACTO (es el preprocess fijo del paquete — `det_limit_side_len` es exactamente el parámetro que op4 implementa). Sesiones det+cls+rec COMPARTIDAS entre los caps. Corpus: 4 páginas acta-like sintéticas deterministas (seed `0xe14de7a2`) 1000×2920 (ratio ≈2.92): cabecera gruesa + grilla 5×6 de 30 votos **manuscritos pequeños** por página (serif itálica 56px con jitter/rotación determinista — el riesgo real de B3) + banda KIT + código 1D de 15 dígitos + pie. 120 votos en total. Lectura con copia congelada de `senal-lectura.ts`.

### Lectura (corrida 1 = corrida 2, texto EXACTO)

| Métrica | det 1920 (producción) | det 1280 (candidato) |
|---|---|---|
| votos leídos | **120/120** | **120/120** — **0 perdidos** ✓ |
| cajas detectadas por página | 71 / 71 / 71 / 71 | **71 / 71 / 71 / 71 — idénticas** |
| anclas de `senal-lectura` por página | 10/10 × 4 | **10/10 × 4 — idénticas** |
| nivel de lectura por página | FUERTE × 4 | **FUERTE × 4 — idénticas** ✓ |
| páginas a 2.ª pasada (esquema escalonado) | — | **0** ✓ |

### Tiempos (2 corridas — determinismo de texto EXACTO, ms dentro de ±4%)

| Métrica (Σ 4 páginas) | det 1920 | det 1280 | Δ |
|---|---|---|---|
| Σ det ms (c1 / c2) | 2461.3 / 2467.6 | **1074.5 / 1117.5** | **−56.4% / −54.7%** |
| Σ cls ms (c1 / c2) | 753.4 / 614.6 | 658.8 / 668.0 | — |
| Σ rec ms (c1 / c2) | 18569.9 / 18994.2 | 18114.7 / 18394.2 | ≈ igual (mismas cajas) |
| total escalonado vs todo-1920 | 22114.5 / 22280.3 | **20016.9 / 20283.8** | **ahorro 9.49% / 8.96%** |
| ratio det (1280/1920) | — | — | **0.436** (c1) — teoría (1280/1920)² = 0.444 ✓ |

**Lectura honesta del ahorro:** el det es el que baja (−56%, casi exacto a la predicción cuadrática del kit) y NO pierde ni una caja, ni un voto, ni una ancla en el corpus. El % de ahorro del OCR COMPLETO (≈9%) depende del share del det: en este corpus sintético el rec domina (30 celdas → 18.6 s de rec). En las trazas reales de producción (informe Vercel 19/10: `det=1766 rec=6599` por celda) el det pesa ~19-21% del OCR → el ahorro real esperado sería ~10-12% del OCR por acta que pase la 1.ª pasada. La validación física con las fotos reales del dueño es la que manda (kit §4): el corpus sintético es la red de seguridad, no el veredicto final.

---

## §4 — Banco 3 · `tools/bench-ep-webgpu/` — B4: EP WebGPU vs WASM

**Protocolo:** mismo harness que banco 2 (det cap 1920, cls/rec lote 6) con **3 brazos** para aislar la variable:
1. `["webgpu","wasm"]` — ort.all + build **jsep** (con fallback automático del EP array),
2. `["wasm"]` — ort.all + jsep (**CONTROL** del mismo build → el speedup es atribuible al EP),
3. `["wasm"]` — ort.wasm + wasmPaths **vendido** (**ANCLA** de producción, byte-idéntico a `public/vendor/`).

Corpus: 2 páginas acta-like sintéticas (seed `0xe14e9c01`, 30 votos manuscritos cada una).

### Resultado: BLOQUEADA (limitación del entorno — kit §4: NO es NO-GO del EP)

```
WebGPU: navigator.gpu PRESENTE en HeadlessChrome 155, pero requestAdapter() → null
        (el headless del sandbox no tiene adapter GPU — software ni hardware).
```

El banco registra el fallo honesto y COMPLETA los 2 brazos wasm como calibración:

| Brazo | Σ det | Σ cls | Σ rec | total ms (3 corridas) | votos / anclas / conf por página |
|---|---|---|---|---|---|
| wasm jsep (control) | 1181-1218 | 384-413 | 8865-9363 | **10661 → 10930.9 → 11192** (±2.4%) | 30/30 · 10/10 · 0.9935 / 0.9932 |
| wasm producción (ancla) | 1357-1365 | 379-415 | 9246-9321 | **11189.6 → 12794.9* → 11039.6** | 30/30 · 10/10 · 0.9935 / 0.9932 |

\* outlier +14.3% de la corrida 2 (ruido del sandbox de 2 núcleos compartidos; las otras 2 dentro de ±5%). **La paridad de TEXTO es EXACTA entre builds y en las 3 corridas** (dígitos, votos, anclas y conf a 4 decimales idénticos) — evidencia de que (a) el build jsep es el mismo motor wasm, y (b) el banco está calibrado contra producción.

**Paso siguiente (dueño):** correr `tools/bench-ep-webgpu/bench.html` en SU Chrome 155 / Windows (WebGPU activo por defecto en Chrome 113+; el banco detecta y reporta el adapter). Si ≥2× + texto idéntico → GO preliminar → kit de activación (flag gradual + fallback wasm) con su decisión en DECISIONS.md. Nada de esto cambia ningún default hoy.

---

## §5 — Determinismo (kit §5.1: ×2, texto EXACTO, ms ±10%)

| Banco | Corridas | Métricas de texto | ms |
|---|---|---|---|
| Banco 1 (lote12) | 2 | EXACTAS (98.33% · Δ−0.172 · accGT 23.33/21.67 · conf 0.9761/0.9778 · flags 100%) | rec ±0.2% · cls ±4.2% ✓ |
| Banco 2 (det1280) | 2 | EXACTAS (0 perdidos · FUERTE 4/4 · 71 cajas · 10/10 anclas) | totales ±1.3% · det ±4% ✓ |
| Banco 3 (webgpu) | 3 | EXACTAS (30/30 · 10/10 · conf 0.9935/0.9932 en TODAS) | control ±2.4% ✓ · ancla: 1 outlier +14.3% (c2), resto ±5% — documentado |

Botón «DESCARGAR JSON» manual en los 3 (§0.2 — nada se descarga solo). Lectura programática equivalente: `window.__benchJson` (el botón sigue siendo el canal manual — patrón bench-rec-int8).

---

## §6 — Reproducción para el dueño (SU máquina es la que manda: 4 núcleos / 8 GB / Chrome 155 / Windows)

```bash
# en la raíz del repo, rama bench/e14-tiempos-bancos-v1:
bun install
# servidor estático con COOP/COEP (paridad Vercel D46; sin cabeceras → numThreads=1 como GH Pages):
#   Cross-Origin-Opener-Policy: same-origin
#   Cross-Origin-Embedder-Policy: require-corp
# Abrir (uno a la vez):
#   /tools/bench-lote12/bench.html      → B2 (lote 6 vs 12)      ~30 s
#   /tools/bench-det1280/bench.html     → B3 (det 1280 vs 1920)  ~2 min
#   /tools/bench-ep-webgpu/bench.html   → B4 (WebGPU vs WASM)    ~1 min
# Cada página corre sola; «REPETIR CORRIDA» para la 2.ª pasada de determinismo;
# «DESCARGAR JSON» para guardar la evidencia. window.__benchJson = mismo JSON.
```

En la máquina del dueño se espera: B2 rec — el mismo patrón (W crece con el lote); B3 — mismo GO de lectura con su GPU/CPU (aquí no hay GPU involucrada: es wasm puro); B4 — el veredicto REAL de WebGPU (aquí indeterminable). Los números absolutos variarán; los patrones (idéntico/no-idéntico, votos perdidos, ratio de det) son los reproducibles.

---

## §7 — Desviaciones (§0.4 — todas documentadas)

1. **Banco 3 carga los builds jsep desde `node_modules/`** (no vendidos): T3 de optimizacion-v1 sacó `ort-wasm-simd-threaded.jsep.*` de `public/` y este kit PROHIBE tocar `public/` — imposible servirlos vendidos. Local-only (gitignored); el ANCLA sí usa el vendido byte-idéntico. Documentado en el README del banco.
2. **Banco 3 tiene 3 brazos, no 2** (control del mismo build + ancla de producción añadidos): rigor del experimento — sin el control, un speedup webgpu no sería atribuible al EP. Dentro del espíritu «mismo harness» del kit.
3. **`.gitignore` SIN cambios:** el kit lo permitía «solo para ignorar artifacts .onnx/pesos» — los 3 bancos no generan artifacts (modelos leídos in-situ de `public/models/`, wasm desde node_modules ya ignorado, JSON solo vía descarga manual). Tocarlo sería un diff sin función.
4. **Banco 1 usa el corpus EXACTO del kit bench-rec-int8** (el kit B2 lo pide: «corpus sintético determinista de 60 líneas que YA existe en ese kit») pero con los umbrales de ESTE kit (1.05×/100%/0.5 — no los 1.3×/99% del kit int8).
5. **Banco 2: op1 queda a 1920 fijo** — `det_limit_side_len` es el parámetro de op4 (config `det_limit_type='max'` del paquete); op1 `reduce_max_side` es preprocess fijo del paquete, no ese parámetro. Justificado en el README del banco.
6. **`senal-lectura` congelada SIN `parciales`:** el banco no corre `clasificarCabecera` (fuera de alcance); la mesa se evalúa por la regex `/MESA[::\s.]*\d+/` — el mismo fallback del módulo de producción.
7. **Bug corregido durante la corrida:** el banco 3 tenía un `esc()` sin definir que impedía pintar la tabla (el JSON sí se computó desde la 1.ª corrida); corregido y re-corrido limpio ×3.

---

## §8 — Archivos tocados y verificación

**Whitelist kit §1 (SOLO esto):**
- `tools/bench-lote12/bench.html` + `README.md` (NUEVOS)
- `tools/bench-det1280/bench.html` + `README.md` (NUEVOS)
- `tools/bench-ep-webgpu/bench.html` + `README.md` (NUEVOS)
- `docs/REPORTE-e14-bench-tiempos-v1.md` (ESTE)
- `docs/worklog.md` / `AGENTS.md` / `docs/ROADMAP.md` (appends al final, sección propia)
- `docs/DECISIONS.md` **INTACTO** ✓ (la decisión es del dueño — igual que el kit bench-rec-int8)
- `.gitignore` INTACTO (desviación 3: sin artifacts que ignorar)

**Diff de producción (kit §1 — debe estar VACÍO):** ver la salida pegada en el PR —
`git diff main --stat -- src/ public/ next.config.ts vercel.json package.json bun.lock` → vacío.

**Verificación kit §5:** `bun run lint` · `tsc` · `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bun run build` — salidas completas en el PR. `tools/` no entra al build (patrón bench-rec-int8).

**Pendiente del dueño:** correr los 3 bancos en SU máquina (§6) y decidir B2 (archivar rec / posible kit cls-solo) · validar B3 con las fotos reales del informe (16 actas) · correr B4 en SU Chrome 155 con GPU (el veredicto WebGPU vive ahí).
