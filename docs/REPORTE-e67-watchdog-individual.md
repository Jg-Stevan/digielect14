# REPORTE — e67-watchdog-rescate-v1

**Kit:** plan del dueño «P6 — watchdog rechazo» (flujo individual: watchdog mata actas válidas — timeout ~30 s observado, pipeline válido a 53.5 s descartado).
**Base:** `main @ 73a7028` (e66 mergeado, PR #81) — EXACTA contra el remoto.
**Rama:** `feat/e67-watchdog-rescate-v1` — commits `01bd6a5` (cambio A: timeout) · `546eb3f` (cambio B: rescate post-timeout) · docs.
**Gates finales:** tsc 0 · lint 0 · **7/7 suites SIN adendas**: historico-enviadas 49/49 · dedup-enviadas 42/42 · qr-identidad 68/68 · autoenvío 33/33 · escaneo-ya-recortado 24/24 · identidad-acta 32/32 · watchdog-relectura 34/34. `package.json`/`bun.lock` INTACTOS.

---

## 1. Resumen ejecutivo

Evidencia de la corrida real del dueño (flujo individual, fuente ARCHIVO):

```
T≈0s     → empieza procesarActa()
T≈32.7s  → watchdog dispara: acta RECHAZADA (ILEGIBLE - TIEMPO DE PROCESADO EXCEDIDO, score 0)
T≈53.5s  → pipeline termina OK: ocrValido=true · cabeceraE14=true · score=8.5 · anclas=10
           ← pero el acta YA estaba RECHAZADA y el resultado válido se DESCARTABA
```

Dos cambios, dos commits:

1. **Cambio A (timeout):** el presupuesto del escaneo individual sube a 120 s — un acta de 53.5 s termina como `OPTIMA` **sin pasar por `RECHAZADA`**.
2. **Cambio B (rescate):** cuando ALCANZA el vencimiento (threshold futuro bajo, colgaje parcial), el desenlace tardío del pipeline ya NO se descarta en silencio: si es válido (`OPTIMA`/`ADVERTENCIA` — el gate ya decidió dentro del pipeline), el rechazo por tiempo **se revierte** con provenance honesto (`scoreRescatadoPor: "post-timeout"`, `tiempoRealMs` real).

Sin cancelación con `AbortController` (follow-up declarado del plan — fuera de alcance). Sin tocar P4 ni MASIVA.

## 2. Recon (M-e67-0 — nombres reales vs plan)

| El plan decía | La realidad en el repo | Consecuencia |
| --- | --- | --- |
| `TIMEOUT_MS = 30_000` | **`TIMEOUT_MS = 15_000`** desde el split del repo (`fbac5de`) — el ~32.7 s observado incluye el pre-proceso de importación (decode HEIC/12MP ANTES del timer del bridge) | Cambio A ajustado: 15_000 → 120_000 (el objetivo 120_000 es literal del plan) |
| Watchdog en `src/lib/e14/individual/` | **`scanner-core-bridge.ts` `escanearActa`** (timeout interno §5): `setTimeout` → resuelve acta RECHAZADA controlada; `masiva/runner.ts` tiene el SUYO (D65, `WATCHDOG_MS=75_000` + gracia + reintento — INTOCADO) | El flujo individual NO pasa `timeoutMs` → cae al default del bridge; ahí vive el fix |
| `Promise.race` pipeline vs timeout | **`new Promise` + `setTimeout`** con flag `vencido` — el race existe pero como `.then` con descarte `if (vencido) return` | El rescate se cablea EXACTAMENTE en esos dos descartes (resolve/reject tardíos) |
| `AbortController` ya wired | NO existe — el pipeline sigue vivo tras el timeout (consumo CPU ~20 s extra: aceptado, mismo trade-off del plan) | Follow-up declarado; este PR no lo incluye |
| Rechazo persiste en IDB | El flujo individual es zustand + historial de sesión (la jornada persiste estado liviano, no el acta completa) — `actaActual` ES la "persistencia" del rechazo | El rescate reescribe `actaActual` (misma ruta que el flujo normal, cero writers nuevos) |
| Timeout del recorte | `RECORTE_TIMEOUT_MS = 30_000` EXISTE APARTE (`recortar`) — ruta DISTINTA (pipelineRecorte), con su propio kit de rescate de recorte horneado (e14-recorte-manual-v1 T1) | INTACTO en este PR; seguirá su propio kit si la evidencia lo pide |

**MASIVA queda byte a byte:** el runner pasa su propio presupuesto (`timeoutMs: Math.max(5_000, WATCHDOG_MS − elapsed)`, ≤75 s) y NO pasa `onRescateTardio` → el callback es `undefined` → no-op. La evidencia del dueño (actas de 60.7 s/56.9 s `OPTIMA` en masiva) ya lo confirmaba.

## 3. Implementación

### 3.1 Cambio A — timeout 15 s → 120 s (`01bd6a5`)

`scanner-core-bridge.ts`:

```ts
const TIMEOUT_MS = 120_000;  // antes 15_000
```

- MASIVA no cambia: pasa `timeoutMs` propio por llamada.
- `RECORTE_TIMEOUT_MS` (recorte manual) intacto — ruta distinta.

### 3.2 Cambio B — rescate post-timeout (`546eb3f`)

**Bridge (`OpcionesEscaneoConTimeout` += `onRescateTardio?`):** en los descartes tardíos de `escanearActa`:

```ts
(acta) => {
  if (vencido) {
    opciones.onRescateTardio?.(acta, Math.round(performance.now() - tInicioEscaneo));
    return;
  }
  ...
},
(error) => {
  if (vencido) { console.info("[e14] pipeline falló tras timeout", {...}); return; }
  ...
}
```

- **Idempotente por construcción:** solo se dispara tras un vencimiento (`vencido === true`); si el pipeline gana la carrera, jamás se llama.
- **Firmas intactas:** campo opcional; bivariance TS intacta (mismo patrón del `timeoutMs` T4).

**Tipos (`Acta`, campos ADITIVOS AL FINAL — contrato D57):**

- `scoreRescatadoPor?: string` — valor canónico `"post-timeout"`; ausente = desenlace normal (jamás inventar).
- `tiempoRealMs?: number` — ms REALES del pipeline completo, medidos en el bridge.

**Store individual (`rescatarActaPostTimeout`):**

1. **Guarda de identidad POR REFERENCIA** (`actaActual === vencida` — espejo `mejorarFotoActa`): si el usuario re-disparó/limpió/abrió otra acta, el rescate se descarta (jamás pisa una captura nueva).
2. **Solo desenlaces válidos rescatan:** `OPTIMA`/`ADVERTENCIA` (el gate ya decidió dentro del pipeline — el plan lo escribía como `ocrValido/gate.completa/senalActa/score≥6`, M-e67-0: en el contrato real ESO es el status del acta; no hay doble gate). `RECHAZADA`/`EN_REVISION_HUMANA` tardíos → queda rechazada (caso C correcto).
3. **Rescatada = `{ ...real, rechazo: null, scoreRescatadoPor: "post-timeout", tiempoRealMs }`** — sin rechazo (era del watchdog, no del gate).
4. **Deshace el `RESCANEO_REQUERIDO`** que `analisisCompletado` estampó 350 ms tras el rechazo — SOLO si la última fila del historial sigue siendo ese rechazo de ESTA página; si no matchea, se conserva (jamás borrar de más).
5. **Desenlace POR LA MISMA RUTA** del flujo normal: `analisisCompletado()` — `OPTIMA` → auto-envío D4 (`registrarEnvio` + `ENVIADA`); `ADVERTENCIA` → motivo no-envío + REVISIÓN. En `"analizando"` NO se llama (el propio AnalyzingView lo dispara leyendo `actaActual` ya rescatada — doble llamada = doble `registrarEnvio`, jamás).
6. **SIM jamás rescata** (§9.2 espejo): el callback ni se pasa para disparos de chip.
7. **TDZ imposible:** la referencia `actaVencida` se asigna al resolver la promesa; microtareas FIFO garantizan que cualquier `.then` tardío del pipeline corre DESPUÉS de la continuación del `await`.

**Traza:** `[e14] RESCATE post-timeout { actaId, score, tiempoRealMs }` · omisión honesta: `[e14] rescate post-timeout omitido (la vista ya avanzó)` / `[e14] pipeline terminó inválido tras timeout`.

## 4. Criterios de aceptación (§Paso 5 del plan)

| # | Criterio | Estado |
| --- | --- | --- |
| 1 | Prueba estática: tsc 0 · lint 0 · suites QA verdes | ✅ 0 · 0 · 7/7 (282 checks, SIN adendas — ningún suite escaneaba los bloques tocados) |
| 2 | Caso A: acta de ~53 s termina `OPTIMA` sin pasar por `RECHAZADA` | ✅ cubierto por cambio A (120 s > 53.5 s) — pendiente de validación del dueño en dispositivo |
| 3 | Caso B (forzar rescate): timeout=5_000 → RECHAZADA a los 5 s → OPTIMA a los ~53 s con `scoreRescatadoPor: "post-timeout"` + log `[e14] RESCATE post-timeout` | ✅ cableado — procedimiento de prueba en §6 |
| 4 | Caso C (rechazo real con timeout=5_000): pipeline tardío inválido → NO se rescata | ✅ guard de validez (status del gate) |

## 5. Desviaciones (M-e67-*)

- **M-e67-0 — nombres/valores reales vs plan:** `TIMEOUT_MS` real era 15_000 (no 30_000 — el ~32.7 s observado incluye pre-proceso de importación); el watchdog vive en `scanner-core-bridge.ts` (no en `individual/`); el rechazo es un acta controlada resuelta (no un `Promise.race` con persistencia IDB); la validez se lee del STATUS del acta (el gate ya corrió dentro del pipeline) en vez de los campos `diag.ocrValido/gate.completa/senalActa` del plan (que existen en el Diagnóstico MASIVA, no en el Acta individual).
- **M-e67-1 — `onRescateTardio` en vez de promesa paralela:** el plan envolvía `procesarActa()` con `Promise.race` en el caller; el caller real (store) NO tiene acceso a la promesa interna del pipeline (el bridge la construye y descarta adentro). El mismo efecto (rescate idempotente, cubre cualquier threshold futuro) se logra con el callback opcional en el PUNTO donde el resultado tardío existía y se descartaba — cero duplicación de la carrera, cero writers nuevos.

## 6. Cómo probar (procedimiento del dueño)

1. **Caso A:** importar el acta que tardaba ~53 s → debe terminar `OPTIMA`/`ENVIADA` sin pasar por `RECHAZADA` (el watchdog de 120 s ya no alcanza a disparar).
2. **Caso B (forzar rescate):** bajar temporalmente `TIMEOUT_MS` a `5_000` en `scanner-core-bridge.ts`, importar la misma acta:
   - A los 5 s: `RECHAZADA — TIEMPO DE PROCESADO EXCEDIDO` (comportamiento de siempre).
   - A los ~53 s: la REVISIÓN pasa sola a `OPTIMA` → `ENVIADA` (auto-envío D4), la fila `RESCANEO_REQUERIDO` desaparece del historial y en consola: `[e14] RESCATE post-timeout { actaId, score, tiempoRealMs }`.
3. **Caso C (rechazo real):** con timeout=5_000, importar una imagen que no es un acta → `RECHAZADA` y en consola `[e14] pipeline terminó inválido tras timeout` — **no se rescata** (correcto).
4. **Regresión MASIVA:** procesar un lote → sin trazas de rescate (el runner no pasa `onRescateTardio`), watchdog D65 intacto (75 s + gracia + reintento).

## 7. Fuera de alcance (follow-ups)

- Cancelación real con `AbortController` (plan §Paso 4 — se evaluará tras medir el impacto).
- `RECORTE_TIMEOUT_MS` del recorte manual (30 s, ruta distinta con su propio kit).
- P5 (memoria/IDB) — PR SEPARADO (#83), no se mezcla con el bug de rechazo.
