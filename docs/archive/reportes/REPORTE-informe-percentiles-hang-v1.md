# REPORTE — feat/informe-percentiles-hang-v1 (REPARTE-3-AGENTES-v1 · Agente C)

**Base:** main `7dd570d` · **Branch:** `feat/informe-percentiles-hang-v1` (kit C + ANEXO tiempos-por-acta)

## 1. Pieza 1 — informe con percentiles + throughput (`src/lib/e14/informe.ts`)

- **Percentiles (json + txt):** `percentil()` PURA e exportada (interpolación
  lineal estándar, método inclusivo `p/100·(n−1)`; `[] → null`, 1 elemento →
  ese elemento; p50 ≡ mediana — para n par da EXACTO el valor del cálculo
  inline que el txt ya hacía para la espera). `percentilesTiempos()` añade
  p50/p95 por etapa con nombres REALES de campo: `decode` (REAL: `precalorMs`
  si `precalentada`, `decodeMs` si no), `esperaMs`, `orientacionProbeMs`,
  `ocrMs`, `totalMs`. JSON: `totales.tiemposPercentilesMs` (aditivo al final).
  TXT: línea `PERCENTILES p50/p95 ms (…): decode X / X - espera … - total …`
  al final de TOTALES (append-only).
- **Throughput:** `throughputEnviadas()` — ENVIADAS/min de reloj:
  `n / ((último fin − primer inicio)/60000)` con inicio = `agregadaEn +
  esperaMs` y fin = inicio + `totalMs` (fórmula documentada junto al cálculo
  y en el helper). JSON `totales.throughput`; TXT línea `THROUGHPUT: …`.
- **Fix bug `0.0s` (kit §1.4):** raíz encontrada — `decodeMs` top-level es 0
  para filas PRECALENTADAS (el decode vivió en el precalor, su ms real es
  `precalorMs`); la media de D66 salía «0.0s» fija con un lote precalentado.
  Corrección: la media ahora suma `precalentada ? precalorMs : decodeMs`
  (misma línea, mismo formato; solo cambia el VALOR — permitido por el kit).
  `nativo/wasm/precalentadas/precalor medio` intactos.
- **APPEND-ONLY:** cero campos borrados/renombrados; las anclas
  `ya-enviada | null;` y `yaEnviadas: filas.filter(…)` quedan byte-idénticas
  (qa-dedup-enviadas 50/50 y qa-historico 49/49 lo verifican).

## 2. ANEXO — tiempos por acta + ahorro de duplicadas

- **Tarea 1 (txt):** sección NUEVA `TIEMPOS POR ACTA (id | status | decode |
  espera | probe | OCR | total | dedup | ahorro)` tras el listado ACTAS.
  Orden: ENVIADAS primero (totalMs desc) → DUPLICADAS (esperaMs desc) →
  resto. Los 3 más lentos de CADA etapa marcados con sufijo `<<`. Formato
  puro: solo campos ya existentes (`id corto = primeros 8 chars`).
- **Tarea 2 (`ahorroMs`):** la UI citada por el anexo («Ahorrado 12.4s») NO
  existe en main (MasivaView L758 muestra solo `≡ <nombre original>`) →
  fórmula propia documentada en `ahorrosDedup()` (PURA): `ahorroMs =
  max(0, REFERENCIA − totalMs_copia)` con REFERENCIA = (1) `totalMs` de SU
  original (`dupOf` presente en el lote — `RegistroMasiva.dupOf` existe,
  ahora expuesto como campo `dupOf` del informe) o (2) media de `totalMs`
  de las ENVIADAS del lote. JSON: `dedup.ahorroTotalMs` +
  `dedup.ahorroEquivalenteActas` (ahorroTotal / media ENVIADAS, 1 decimal) y
  por acta `dupOf`/`ahorroMs` (condicionales — ausentes si no aplican).
  TXT: columna `ahorro` en la tabla por acta (solo duplicadas con dato).

## 3. Pieza 2 — detector de hang (observabilidad modo dev)

- **`src/lib/e14/obs/hang.ts` (NUEVO)** — patrón del módulo dispositivo.ts:
  `iniciarDetectorHang()` IDEMPOTENTE, todo silencioso, cero costo tras
  detener. Dos sensores SOLO-DURACIONES (privacidad dura):
  1. **longtask** — `PerformanceObserver('longtask')`: cada task > 50 ms
     (`LONGTASK_UMBRAL_MS`) → evento con su duración redondeada.
  2. **drift** — `setInterval` 500 ms (`DRIFT_TICK_MS`): gap esperado-vs-real
     > 3000 ms (`DRIFT_UMBRAL_MS`) → evento con el GAP REAL (kit §2.2).
- **Contrato (tipos.ts — todo append-only):** `TipoEvento` += `"hang"` AL
  FINAL; interfaz `HangEvento {fuente, duracionMs, umbralMs, breadcrumbs}`
  (breadcrumbs sin contenido por contrato — qa-obs-privacidad 7/7 ✓);
  `EventoObs.datos` += `HangEvento`; `ReporteSesion.hangResumen?` opcional
  (informes previos no cambian de forma). qa-obs-contract 38/38 ✓ (sus 12
  tipos anclados siguen exportándose).
- **Agregación por sesión:** `resumenHangsDe()` PURA (cuenta, mayorMs,
  totalMs) consumida por `export.ts` → `ReporteSesion.hangResumen` (aditivo
  al final del reporte de consola).
- **Wiring (desviación documentada):** `page.tsx` no estaba en el territorio
  listado; se añadió EXACTAMENTE 1 llamada `iniciarDetectorHang()` en el
  bootstrap existente (mismo patrón que los demás `iniciar*`) para que el
  detector no sea código muerto. Nada más tocado en ese archivo.
- **Tests (`obs/hang.test.ts`, 9):** timers falsos + reloj controlado
  (`setSystemTime`) — gap 3.2 s emite `hang {fuente:"drift", duracionMs:3200}`;
  gaps normales no emiten; longtask >50 ms sí y ≤50 ms no (umbral ESTRICTO);
  identidad sesion/dispositivo/appVersion del evento; idempotencia; node/SSR
  no arma nada; agregación pura.

## 4. Gate (árbol commiteado)

- `tsc --noEmit`: **0 errores** · `lint`: **0 err / 0 warnings**
- vitest: **183/183** (162 base + 13 percentiles/ahorro + 9 hang — el 183
  total del runner)
- QA: **294/294** regresión + obs **61/61** (contract 38 · privacidad 7 ·
  transporte 8 · ui 8) — 11/11 harnesses OK, cero anclas rotas
- knip: informativo (~40 líneas — sin export sin-consumidor nuevo: hang.ts
  tiene bootstrap + export.ts + tests)
- (build + check-quality.sh íntegros: auditoría del orquestador en serie)

## 5. Riesgos / puntos a auditar

- **Volumen longtask:** cada task >50 ms genera evento (kit literal). En un
  lote pesado el buffer FIFO (tope 500, TTL 30d) puede rotar eventos viejos —
  auditar en el lote 2 si hace falta un tope por minuto (decisión del dueño).
- La etapa `decode` de percentiles/tabla usa el decode REAL (precalor cuando
  precalentada) — consistente con la media corregida, NO con `decodeMs` top-
  level crudo (que es 0 en precalentadas).
- `ahorrosDedup` usa la media de ENVIADAS como fallback cuando la original
  no está en el lote — documentado en el propio helper.
