# REPORTE — perf/dedup-rechequeo-reserva-v1 (REPARTE-WAVE2-tiempos-v1 · Agente B)

**Kit:** `REPARTE-WAVE2-tiempos-v1.md` §2 (Tarea B1 — re-chequeo post-reserva)
**Base del kit:** main `66cc23c` · **Base real del branch:** main `ae39a64` (drift deploy Cloudflare — §1.1)
**Branch:** `perf/dedup-rechequeo-reserva-v1` · **Territorio:** `masiva/runner.ts` + su QA (cumplido — `git diff main..HEAD` solo toca runner.ts + test nuevo)

---

## 0. Qué cierra B1 (el hueco que A wave-1 documentó)

El kit A de la wave 1 (`docs/REPORTE-perf-probe-dedup-precoz-v1.md` §2.3)
documentó el **hueco residual** de la carrera ingesta×runner: una fila puede
ser marcada DUPLICADA por `cadenaDedup` (ingesta background FIFO) **entre**
la reserva del pool (`siguientePendiente()` en `bucle()`) y la entrada a
`procesarUno` — el snapshot que el pool le pasa nace viejo y la fila corría
el pipeline completo (probe + OCR ~30 s) para un desenlace que YA existía.
El guard e72 solo protege filas YA marcadas **al momento de llegar** con
estado DUPLICADA en el snapshot.

B1 cierra la carrera con UN re-chequeo: `procesarUno` re-lee el estado REAL
de la fila en el store antes de la rama e71/e72; si el store ya la marca
DUPLICADA, el re-chequeo alimenta esa rama (reuso <1 s, **OCR jamás pagado**).

## 1. Trazabilidad del kit y desviaciones

### 1.1 Drift de base (declarado, verificado, no afecta el kit)
- El kit declara base `main = 66cc23c` (PRs #98 B + #99 C + #100 A — wave 1 GO 3/3).
- Al clonar, main = `ae39a64` (2 commits nuevos: `5a45d87` deploy Cloudflare
  Pages + `ae39a64` su worklog — tocan `next.config.ts`, `public/_headers`,
  `wrangler.toml`, `docs/`).
- **Verificación de territorio:** `git diff 66cc23c..ae39a64 --
  src/lib/e14/masiva/runner.ts scripts/qa-dedup-enviadas.ts` = VACÍO (los
  commits de deploy no tocan el territorio B). El branch nace de `ae39a64`
  para integrar sin conflictos.

### 1.2 Desviaciones del kit (2 — ambas menores y justificadas)
1. **`export` en `procesarUno`** (1 palabra + 3 líneas de comentario): el kit
   exige test **conductual** («`procesarUno` entra por reuso, OCR jamás
   invocado, traza emitida») — imposible sin un punto de invocación. Se
   exporta con comentario `WAVE2 B1: export SOLO-TEST`. Patrón del GO wave 1
   (`informe.ts` exporta unidades para `informe.percentiles.test.ts`); knip
   tiene `src/**/*.test.ts` como entry → **0 ítems nuevos** (verificado: knip
   main = 40 líneas, knip branch = 40 líneas, idéntico). Comportamiento
   byte-idéntico.
2. **Líneas del kit (L338-340) vs reales (L336-337)**: drift de numeración
   por los PRs integrados tras redactar el kit — nada funcional (la
   inserción va exactamente entre `let fila = filaEntrante;` y
   `if (fila.estado === "DUPLICADA") {`, ambos intactos byte a byte).

**No desviado:** la cadena del re-chequeo es la del kit carácter a carácter
(comentario `WAVE2 B1` incluido); la rama e71/e72 existente
(`reutilizarResultado` → `esperarDesenlaceOriginal` → fallback
des-marcar/reprocesar) queda **intacta byte a byte**; `dispararPrefetch` sin
tocar (ya excluye DUPLICADA); `PROCESAMIENTO_CONCURRENTE` (L132, wiring wave
1) sin tocar; store.ts / orientacion.ts / informe.ts / flags — sin tocar.

## 2. Cambios por archivo

| Archivo | Cambio | Líneas |
|---|---|---|
| `src/lib/e14/masiva/runner.ts` | Re-chequeo post-reserva ANTES de la rama DUPLICADA + `export` solo-test en `procesarUno` | +21 (18 del kit + 3 de comentario del export) |
| `src/lib/e14/masiva/runner-rechequeo.test.ts` | NUEVO — test conductual del re-chequeo (3 tests) | +231 |

### El cambio (kit B1, literal)
```ts
let fila = filaEntrante;
// WAVE2 B1 — re-chequeo post-reserva: la referencia del snapshot puede estar
// vieja — cadenaDedup (ingesta background FIFO) pudo marcar DUPLICADA la fila
// entre siguientePendiente() y aquí. El duplicado JAMÁS paga probe+OCR
// (kit e71 literal; e72: totalMs de la copia ≈ 0). Re-lectura del estado REAL
// del store — si ya está marcada, entra por la rama de reuso de abajo.
const filaFresca = useMasivaStore
  .getState()
  .filas.find((f) => f.id === filaEntrante.id);
if (
  filaFresca &&
  filaFresca.estado === "DUPLICADA" &&
  fila.estado !== "DUPLICADA"
) {
  logger.info(
    `[e14] dedup fila=${fila.id} re-chequeo post-reserva → reuso (carrera cerrada)`,
  );
  fila = { ...fila, estado: "DUPLICADA", dupOf: filaFresca.dupOf ?? null };
}
if (fila.estado === "DUPLICADA") {   // ← rama e71/e72 existente, intacta
```

Semántica del guard (idempotente y conservadora):
- `filaFresca` inexistente (fila quitada de la cola) → el snapshot manda (la
  rama e72 de abajo tiene sus propios guards anti-zombi).
- `filaFresca.estado !== "DUPLICADA"` (no hubo carrera) → cero efecto.
- Snapshot ya DUPLICADA → la condición `fila.estado !== "DUPLICADA"` evita
  re-marcar (la rama de abajo funciona igual que hoy).
- Solo el caso de carrera **real** (snapshot PENDIENTE + store DUPLICADA)
  adopta `estado: "DUPLICADA"` + `dupOf` **del store fresco** (nunca
  inventado) → entra por reuso e71 (copia <1 s) → totalMs de la copia ≈ 0
  (e72), OCR de cero.

## 3. Tests (`runner-rechequeo.test.ts` — patrón runner-watchdog.test.ts)

Mocks de infra (worker/OCR/bridge/IDB/precalor/QR/logger) — el store
`useMasivaStore` es el REAL (zustand, `setState` directo) para ejercitar el
re-chequeo contra el estado vivo:

1. **Carrera cerrada (positivo)**: snapshot `PENDIENTE` + store con la fila
   ya `DUPLICADA`+`dupOf` → `procesarUno` entra por reuso: traza
   `re-chequeo post-reserva → reuso (carrera cerrada)` emitida ·
   `getBridge` **sin llamadas** (OCR jamás invocado) · registro copiado con
   `acta.status = "DUPLICADA"` (e66: copia de una ENVIADA) ·
   `diagnostico.tiempos.ocrMs = 0` (guard e72) · `dupOf` adoptado del store
   fresco · fila final `LISTA`/`statusActa: DUPLICADA` en la bandeja.
2. **Sin carrera (negativo)**: fila fresca `PENDIENTE` → pipeline normal
   (0 cambios): sin traza de re-chequeo · `consumirMaestro` SÍ llamado
   (pasó la puerta dedup hacia el pipeline) · sin copia de desenlace (el
   único `guardarRegistro` es el post-mortem `ERROR` honesto del mock, sin
   `acta`).
3. **Orden fuente (regresión estructural)**: el re-chequeo vive ENTRE
   `let fila = filaEntrante;` y `if (fila.estado === "DUPLICADA") {` — las
   dos líneas del kit intactas; `fila = { ...fila, estado: "DUPLICADA",
   dupOf: filaFresca.dupOf ?? null };` presente; el fallback e72
   (`sin-original reprocesa-completo`) sigue en el fuente.

## 4. Anclas QA — verificación ANTES y DESPUÉS (prohibido común #3)

Antes de editar: `grep -n "DUPLICADA\|reutiliz\|filaEntrante"
scripts/qa-dedup-enviadas.ts` → ninguna ancla grepea `let fila =
filaEntrante;` ni el `if (fila.estado === "DUPLICADA") {` (las anclas del
runner: `siguientePendiente` L230, `reutilizarResultadoCritica` L390 — no
tocadas). QA externos sobre runner.ts (`qa-qr-identidad.ts` L353, `qa-watchdog-relectura.ts` L150): anclan por `indexOf`/orden relativo de
bloques río abajo (capa-0/watchdog) — la inserción es río arriba y preserva
el orden. **Después: QA 11/11 verde** — dedup-enviadas **50/50**,
qr-identidad 72/72, watchdog-relectura 34/34, historico 49/49, autoenvío
33/33, etc. (check-quality completo en §5).

## 5. Gate completo (igual que wave 1)

| Gate | Resultado |
|---|---|
| `bunx tsc --noEmit` | **0 errores** |
| `bun run lint` | **0/0** |
| `bun run test` | **204/204** (201 base + 3 nuevos de B1) |
| `bash scripts/check-quality.sh` | **QA 11/11** — autoenvío 33/33 · dedup-enviadas **50/50** · escaneo-ya-recortado 24/24 · historico-enviadas 49/49 · identidad-acta 32/32 · obs-contract 38/38 · obs-privacidad 7/7 · obs-transporte 8/8 · obs-ui 8/8 · qr-identidad 72/72 · watchdog-relectura 34/34 · **build exit 0** |
| knip | 40 líneas = idéntico a main (**0 ítems nuevos**) |

## 6. Impacto esperado (honesto — números del diagnóstico del kit §0)

La espera en cola (p50 120.6 s) y el OCR (p50 21.3 s) son estructurales/no
tocables. B1 ataca el **coste residual de la carrera**: hoy un race-loser
paga probe (~10 s p50) + OCR (~21 s p50) por un desenlace que ya existía;
después de B1 muere en reuso (<1 s). La magnitud real depende de cuántas
filas caen en la ventana (es rara por diseño — `cadenaDedup` corre en
background FIFO y suele ganar) — el smoke §6.1 del kit es el instrumento del
dueño para verla en campo:

1. Subir 2 archivos IDÉNTICOS de golpe → la copia muere <1 s; si cae en la
   carrera, traza `re-chequeo post-reserva → reuso (carrera cerrada)` y
   totalMs ≈ 0 SIN OCR.
2. Kill switch intacto: `e14-flags-overrides` `{"poolWorkers":1}` sigue
   bajando a secuencial (PROCESAMIENTO_CONCURRENTE sin tocar).

## 7. Sin bloqueos

Nada pendiente de este branch para poder mergear. Smoke manual (kit §6) es
post-merge en deploy de prueba (dueño).
