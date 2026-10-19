# REPORTE — KIT e14-prowarm-ocr-v1 — Pre-warm REAL de RapidOCR (cero frío en la 1.ª acta)

## Resumen

`rapidOcrPrecalentar()` (rapidocr.ts, T1) corre UNA inferencia dummy sobre un canvas SINTÉTICO 640×480 (texto dibujado en código — cero fotos del usuario, §0.8) por det+cls+rec sobre el MISMO singleton `rapidOcrInit()`, y **DESCARTA el resultado** (§0.2). Disparos: al montar MASIVA (T2) y diferido 2 s en ScanView (T2b). Flag de módulo `prewarmHecho` = 1 sola vez por carga de página. NUNCA llama `reconecerRapidOcr` del bridge — los globales `ultimoOcr*` quedan intocables (§0.3). Fallo → `console.info` + `false`: frío como hoy, el pipeline no depende de esto (el `rtSingleton` reintentable existente no se toca). Cero UI (§0.7), cero dependencias, cero cambios de desenlaces.

## Whitelist §1 vs diff real

| §1 | Real | OK |
|---|---|---|
| `src/lib/e14/ocr/rapidocr.ts` (T1) | M — 1 export + flag `prewarmHecho` + bloque Init | ✓ |
| `src/components/e14/screens/MasivaView.tsx` (T2) | M — 1 useEffect + 1 import | ✓ |
| `src/components/e14/screens/ScanView.tsx` (T2b) | M — efecto existente + timer 2 s + clearTimeout | ✓ (+1 import — DESVIACIÓN menor #1) |
| `docs/REPORTE-e14-prowarm-ocr-v1.md` | NUEVO (este) | ✓ |
| `docs/DECISIONS.md` / ROADMAP / worklog / AGENTS | registrados (D50) | ✓ |

`git diff --name-status main` = EXACTAMENTE los 3 archivos de código. Zonas prohibidas (bridge.ts, scanner-core-bridge.ts, masiva/**, public/**, next.config.ts, vercel.json, .github/**, package.json/bun.lock) — VACÍO.

## Evidencias §4 (trazas verbatim de la verificación; acta real = `original.jpg` de `e14-diag-mesa-001`, importada por MASIVA, mismo archivo en ambos builds)

**§4.1** lint 0-0 · `tsc --noEmit` 0 · `BUILD_STATIC=1 … bun run build` OK.

**§4.2 Paridad SIM:** `score=8.2 filtro=bw` · `score=7 filtro=original` · `score=4.3 filtro=original` — los 3 desenlaces EXACTOS de main (el warm-up no corre en el pipeline SIM, §0.6).

**§4.3/§4.4 Frío y traza intacta:**

- **main (frío, sin pre-warm)** — 1.ª celda + pipeline:
  `[e14-rapidocr] celda: det=788ms cls=173ms rec=3745ms · 41 cajas · 35 líneas · conf 93.8% · 4840ms`
  `[e14] pipeline ARCHIVO/file total=6507ms (… ocr=4843 motor=worker …) … score=8.5 … cod:710003993010102 … quad=[0.383,0.262 0.633,0.280 0.610,0.863 0.357,0.868]`
- **rama (con pre-warm)** — calentamiento + 1.ª acta real:
  `[e14-prowarm] listo det=565ms cls=44ms rec=995ms · 3 cajas · 3 líneas`  ← resultado DESCARTADO
  `[e14-rapidocr] celda: det=690ms cls=180ms rec=4703ms · 41 cajas · 35 líneas · conf 93.8% · 5723ms`
  `[e14] pipeline ARCHIVO/file total=7406ms (… ocr=5729 …) … score=8.5 … cod:710003993010102 … quad=[0.383,0.262 0.633,0.280 0.610,0.863 0.357,0.868]` — **quad, cod, score, conf y 35 líneas IDÉNTICOS a main; el `ocr=` del pipeline refleja SOLO el acta real (5729 ≈ celda 5723; los ms del warm-up 565/44/995 NO se sumaron — §4.4 ✓)**.

**NOTA HONESTA (misma del kit vercel-perf):** sandbox de 2 cores + modelos servidos por localhost (ms) NO reproduce el frío real del dueño (Vercel: ~16 MB de modelos por red + compilación ORT — acta 1 OCR 35.9 s vs 8.3 s caliente, informe 19/10). En sandbox ambas corridas son comparables (varianza de ruido en rec con el mismo acta) porque el coste de red —la mayor parte del pico— no existe aquí. Lo que el E2E SÍ prueba: el pre-warm ejecuta det+cls+rec COMPLETOS sobre la sesión singleton real y queda caliente ANTES de la 1.ª acta. La eliminación del pico se valida en PRODUCCIÓN (pasos del dueño, abajo): tras el redeploy, `[e14-prowarm] listo` debe aparecer AL MONTAR MASIVA y la 1.ª celda de la 1.ª acta real debe venir con rec comparable al de una acta caliente (sin el 35.9 s).

**§4.5 Re-montaje idempotente:** ESCANEAR→MASIVA→ESCANEAR→MASIVA → `prowarm listo: 1`, `prowarm fallo: 0` — UNA sola traza por carga de página (en el E2E el timer de 2 s de ScanView disparó primero; el montaje de MASIVA resolvió al instante vía flag — ambos caminos del kit verificados).

**§4.6 Fallo controlado:** `network route --abort` del `ch_PP-OCRv4_rec_infer.onnx` + recarga →
`[e14-prowarm] fallo (continua como hoy): Failed to fetch` — sin crash, página viva. Desbloqueado el modelo + acta por MASIVA → el pipeline RECUPERA solo (init reintentable existente): `total=7232ms (… ocr=5542 … ocrValido=true …)` — el fallo del pre-warm no envenena nada.

**§4.7 Bundle y heap:** chunk eager principal IDÉNTICO (1,351,742 B en ambos builds); el chunk que contiene rapidocr 346,088 → 346,918 B = **+830 B (+0.026 % del total JS — el módulo ya estaba en el grafo, §2)**. Heap (performance.memory): 16.6 MB (carga) → 25.2 MB tras el pre-warm (**+8.5 MB movidos a ANTES de la 1.ª acta** — hoy los paga la 1.ª acta, §2) → 81.8 MB post-acta (main: 82.8 MB — comparable).

## Desviaciones

1. **MENOR:** `ScanView.tsx` necesitó 1 import (`rapidOcrPrecalentar`) no listado en la tabla §1 — implícito en T2b (sin él la tarea es imposible). Ninguna otra zona tocada.
2. **NOTA:** §1 dice «1 export + 2 módulo-flags»; el bloque literal del kit define UN flag (`prewarmHecho`) — se siguió el código literal.
3. **BLOQUEADA: ninguna.**

## Pasos del dueño

1. Merge del PR (DRAFT — solo con tu orden) → **redeploy manual en Vercel** (`docs/DEPLOY-vercel.md` §2: `git pull` + `bunx vercel --prod`) → **Ctrl+Shift+R**.
2. Abrir MASIVA con DevTools abierto → consola: `[e14-prowarm] listo det=… cls=… rec=…` ANTES de procesar nada.
3. Importar la 1.ª acta real → PROCESAR → la 1.ª traza `[e14-rapidocr] celda` debe venir con rec comparable al de una acta caliente — **sin el pico de 35.9 s del informe del 19/10**.
4. El heap sube al montar MASIVA (≈ +8.5 MB, modelos) en vez de al procesar — comportamiento esperado (§2).
