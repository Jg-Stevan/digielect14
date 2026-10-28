# REPORTE — perf/probe-miniatura-dedup-precoz (REPARTE-3-AGENTES-v1 · Agente A)

**Base:** main `7dd570d` · **Branch:** `perf/probe-miniatura-dedup-precoz`

## 1. Cambio 1 — mini-probe de orientación a 320 px (IMPLEMENTADO)

`probeOrientacion` (`src/lib/e14/orientacion.ts`) sondea PRIMERO una miniatura
(lado mayor `PROBE_MINI_LADO = 320`, JPEG q0.92, aspecto preservado, helpers
del repo `loadImageMemo` + `canvasCon`) y solo manda su decisión si alcanza el
**FALLO SEGURO**; en cualquier otro caso re-corre el sondeo a resolución
original — el comportamiento de HOY byte a byte — y ESA es la decisión.

- **Una sola función decide (`sondeoDe`)**: miniatura y original corren la
  MISMA función (mismos crops, mismo orden D62, mismos atajos, mismo MARGEN,
  mismo presupuesto `PROBE_BUDGET_MS=12000` compartido por t0). Solo cambia la
  resolución de la fuente → la decisión es idéntica por construcción.
- **Fallo seguro (`miniaturaConfiada`)** — solo 3 desenlaces se confían:
  1. corte `sana` (0° leyó texto no-DEBIL — la miniatura sub-lee: si ella lee,
     la original lee ≥ ⇒ mismo `aplicado=0`),
  2. corte `confirmada` (gate del dueño e70: quadWorker + ≥3 anclas + conf
     ≥0.7 a 0°),
  3. `aplicado=1` con ganadora fuerte: `≥ PROBE_MINI_ANCLAS_MIN (2)` anclas
     estructurales Y `≥ PROBE_MINI_CONF_MIN (0.6)` conf.
  `vacio`/`presupuesto`/aplicado-débil **NUNCA** se confían (dirección del
  sesgo conocida y conservadora: hacia re-corrida original).
- **Campo nuevo ADITIVO**: `orientacionProbeEscala` en el resultado del probe
  (320 = decidió la miniatura · >320 = re-corrida original · ≤320 = foto ya
  pequeña). Traza `escala=` ADITIVA AL FINAL de la línea de siempre (D51/D56).
- **Cero cambios de firma/call sites**: el bridge (`scanner-core-bridge.ts`)
  no requirió edición — sigue leyendo `rot/aplicado/ms` del resultado.
- **Foto ya pequeña (≤320 px)**: UN solo sondeo sobre la fuente real
  (byte-idéntico a hoy).
- Tests: `src/lib/e14/orientacion.mini.test.ts` — DOM/OCR mockeados (patrón
  completitud.test.ts), ejercita camino mini confiado, fallo seguro → original
  (`orientacionProbeEscala>320`), foto pequeña, y que ambos caminos reciben la
  MISMA secuencia de rec por rotación (misma función `sondeoDe`).

## 2. Cambio 2 — dedup precoz ANTES del probe (ANÁLISIS + ALCANCE REAL)

Leído el flujo real (solo-lectura): `store.ts (cadenaDedup)`, `runner.ts
(procesarUno: rama DUPLICADA + capa0-qr)`, `dedup.ts`, `identidad-qr.ts`,
`runner-dedup.ts`, `cola.ts`. Conclusión honesta, con evidencia:

1. **QR idéntico YA muere antes del probe**: capa0-qr (runner.ts L441-575)
   decodifica el QR pre-OCR y reutiliza/aplaza (24/35 duplicadas del lote 1);
   el guard e72 `esperarDesenlaceOriginal` (runner-dedup.ts) evita el
   reproceso completo de las marcadas con original en vuelo.
2. **dhash marca en la INGESTA** (`cadenaDedup`, store.ts L459-520, background
   FIFO): SHA-256 → dhash → Hamming ≤6 → DUPLICADA persistente con `dupOf`.
   Las filas marcadas entran por la rama DUPLICADA (reuso <1 s, sin probe).
3. **Hueco residual = carrera ingesta-vs-runner**: una re-fotografía cuyo QR
   no decodifica (sin-payload) y cuyo hash de ingesta aún no aterrizó cuando el
   pool la reserva entra al pipeline completo y paga probe (+OCR). **El corte
   para ese caso exige wiring en `runner.ts` (llamada pre-pipeline) o en
   `store.ts` (cadenaDedup síncrona)** — territorios del Agente B / no
   asignados a A (REPARTE §1). Per kit A §3.5: se DOCUMENTA, no se fuerza.
4. **Mitigación real ya entregada por el Cambio 1**: para los race-losers el
   probe cae de ~10.6 s a ~0.1-0.4 s (camino miniatura o fallo seguro temprano)
   — ~97 % del costo de probe medido desaparece en TODOS los caminos, incluido
   el residual. El OCR del race-loser (~16.7 s) queda fuera del mandato del kit
   («sin tocar el motor OCR ni cambiar ninguna decisión»).

## 3. Gate (árbol commiteado)

- `tsc --noEmit`: **0 errores** · `lint`: **0 err / 0 warnings**
- vitest: **173/173** (162 base + 11 nuevos del mini-probe)
- QA: **294/294** regresión (33+50+24+49+32+72+34) + obs **61/61**
  (38+7+8+8) — 11/11 harnesses OK, cero anclas rotas
- knip: informativo, sin deltas nuevos vs baseline (~36+18)
- (build + check-quality.sh íntegros: corren en la auditoría del orquestador
  en serie — límite de RAM del sandbox con agentes en paralelo)

## 4. Riesgos / puntos a auditar

- `miniaturaConfiada`: los 3 desenlaces confiados son conservadores; auditar
  los umbrales `PROBE_MINI_ANCLAS_MIN=2` / `PROBE_MINI_CONF_MIN=0.6` contra
  actas reales del dueño (assets `acta-sim-*` en tests unitarios con OCR
  mockeado; la prueba de campo es del lote 2).
- La miniatura SUB-LEE: el sesgo documentado es hacia «no confiar» → re-corrida
  original (costo, jamás riesgo electoral).
- `orientacionProbeEscala` es ADITIVO: ningún campo previo cambió de forma.
