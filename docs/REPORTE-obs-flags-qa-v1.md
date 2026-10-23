# REPORTE — `feat/obs-flags-qa-v1` (KIT AGENTE 3 — Transporte + QA + Gate)

> Ola `e14-observabilidad-v1` · Agente 3 · **Entrega FASE 0** (el núcleo del agente 1
> `feat/obs-nucleo-v1` aún NO existe en origin al momento de esta entrega — verificado
> con `git fetch origin`; branches remotos: `main`, `refactor/runner-logger-v1`,
> `refactor/ui-hooks-v1`).
> Base: `main` @ `b603183` (merge PR #93 — refactor/ui-hooks-v1), EXACTA como exige README-KITS §1.
> **El agente NO mergea** — el dueño integra en el orden §1 (núcleo 1º, luego 2 y 3).

---

## 1 · Qué se hizo (FASE 0 completa)

Por orden de tareas del kit (un commit por tarea; A3-C1 y A3-C5 son FASE 1 — bloqueados por el núcleo, ver §6):

| Tarea | Commit | Contenido |
|---|---|---|
| A3-C2 | `064ff8a` | `scripts/qa-obs-contract.ts` — el contrato congelado: **38 anclas** (12 tipos §4.2 · 6 claves §4.1 · 4 defaults D4 · `capturando` anti-recursión · perf sin PII `actaIdHash`/`fnv1a8` · 11 grupos de firmas §4.3 con los 34 `export function` + `ErrorBoundaryObs` · higiene transporte: sin `console.*` + `fallosSeguidos`) |
| A3-C3 | `bb424a3` | `scripts/qa-obs-privacidad.ts` (**7 anclas**: cero `console.*`, `setItem` solo claves §4.1, buffer/transporte sin blob/File/dataURL, `miniaturas` siempre gated por política, cero `datos.actaId`, `actaId` plano solo en captura.ts, export re-verifica toggles) + `scripts/qa-obs-transporte.ts` (**8 anclas**: no-op sin `endpointReportes`, outbox en DB propio `e14-obs-outbox` y JAMÁS `indexedDB.open("e14-obs"`, kill local `FALLOS_KILL_LOCAL=3`, backoff 60_000/300_000/1_800_000, scrub por `leerPolitica`, lote `{loteId,deviceId,appVersion,eventos[]}`, batcher `10*60*1000` ≤ 50) |
| A3-C4 | `3770e08` | `scripts/qa-obs-ui.ts` (**8 anclas** del contrato del agente 2) + `public/flags-ejemplo.json` (las 5 `FlagsApp` con efecto y default de cada una) |
| A3-C6 (FASE 0) | este commit | `docs/CHECKLIST-CAMPO-observabilidad.md` (los 9 ítems §6 del plan madre con pasos y DevTools) + `docs/ENDPOINT-REPORTES.md` (guía del receptor sin leer código) + este REPORTE + append a `docs/worklog.md` |

**Total de anclas QA-obs definidas: 61** (38 + 7 + 8 + 8). Todas están escritas contra el
contrato §4 de README-KITS y pasan a evaluarse en cuanto sus objetivos aterrizan (§3 M-A3-1).

## 2 · Los 7 QA viejos: 294/294 INTACTO

Corridos antes y después de cada commit de esta rama:

```
QA autoenvío: 33/33 OK
QA dedup-enviadas: 50/50 OK
QA escaneo-ya-recortado: 24/24 OK
QA historico-enviadas: 49/49 OK ✓
QA identidad-acta: 32/32 OK
QA qr-identidad: 72/72 OK
QA watchdog-relectura: 34/34 OK
                        ─────────
                        294/294
```

Cero toques a `runner.ts`, `cola.ts`, `historico.ts`, `informe.ts`, `ScanView.tsx`,
`MasivaView.tsx`, `ActasView.tsx`, `page.tsx`, `package.json` (verificado con
`git diff --name-status main..HEAD`: solo `scripts/qa-obs-*.ts`, `public/flags-ejemplo.json`, `docs/`).

## 3 · Desviaciones declaradas (con razón y archivo:línea)

- **M-A3-1 — Modo PENDIENTE de los 4 QA-obs en FASE 0** (`scripts/qa-obs-contract.ts:100-107`,
  `scripts/qa-obs-privacidad.ts:87-95`, `scripts/qa-obs-transporte.ts:56-65`, `scripts/qa-obs-ui.ts:88-95`).
  El kit manda escribir los QA greps ANTES de que exista el código («greps sobre el CONTRATO — no
  necesitan el código»), pero el gate del branch corre `for f in scripts/qa-*.ts` y esos 4 archivos
  entran al glob desde el primer commit. Sin mecanismo, la rama nacería con el gate en rojo por
  anclas que NO PUEDEN evaluarse aún. Solución: cada QA define un sentinel (ausencia de
  `obs/tipos.ts` / `obs/transporte.ts` / `components/e14/dev/**`) → reporta
  `QA obs-<x>: 0/N · PENDIENTE NÚCLEO/UI (FASE 0) — gate FASE 0 OK` y **sale 0**. Cuando el
  objetivo existe → modo ESTRICTO automático (fallo = exit 1), sin cambios en el QA. Riesgo de
  enmascarar desvíos: NULO a partir de FASE 1 (con el objetivo presente el sentinel no puede
  dispararse).
- **M-A3-2 — `public/flags-ejemplo.json` es JSONC (comentarios `//`)**: el kit pide «cada una con
  comentario de su efecto y default» y JSON no tiene comentarios; como `flags-ejemplo.json` NUNCA
  lo parsea la app (el real es `flags.json`, nombre exacto), se documenta con `//`. El
  `flags.json` REAL debe copiarse SIN comentarios — advertido en la cabecera del propio archivo y
  en `docs/ENDPOINT-REPORTES.md` §2.
- **M-A3-3 — Firmas §4.3 congeladas como 11 grupos por archivo** (los 34 `export function` +
  `export const ErrorBoundaryObs`) y no «las 13 firmas» que menciona el kit A3-C2 ancla 6: el
  §4.3 real del README-KITS declara 34 funciones; se congelan TODAS (fuerza igual, granularidad
  por archivo para mantener la meta ~40 checks del kit → 38).
- **M-A3-4 — Secciones del PanelDev (ancla A3-C4 e) congeladas a nivel CONCEPTUAL** (7 regex:
  modo dev, salud, errores, perf, uso, política, override/kill): el kit no fija los títulos
  exactos y advierte («si el agente 2 usó textos ligeramente distintos, NO cambies el QA a
  ciegas»). Al integrar, cualquier desvío de texto se coordina con el dueño y se documenta aquí.
- **Constantes del transporte congeladas por `qa-obs-transporte.ts`** (`FALLOS_KILL_LOCAL=3`,
  `BACKOFF_MS=[60_000,300_000,1_800_000]`, `BATCHER_MS=10*60*1000`, `LOTE_TOPE=50`): los VALORES
  son del kit A3-C1; los NOMBRES los fija la implementación A3-C1 de esta misma rama (cabecera
  del QA lo declara). Renombrar en el futuro exige acuerdo con el dueño (patrón kit A3-C4 ⚠).

## 4 · Gate completo (por commit, contra el árbol commiteado)

| Gate | Resultado |
|---|---|
| `bunx tsc --noEmit` | **0 errores** (los 4 commits) |
| `bun run lint` | **0 errores / 1 warning** — la warning es `src/lib/logger.ts:25` (directiva muerta), PREEXISTENTE y ZONA DEL AGENTE 1 (la elimina él; README-KITS §3 lo prevé). Sin warnings nuevas |
| `bun run test` (vitest) | **70/70** (los 4 commits) |
| QA 7 viejos | **294/294 intacto** (los 4 commits — §2) |
| QA 4 nuevos obs | `0/38 · 0/7 · 0/8 · 0/8 PENDIENTE (FASE 0)` rc=0 — se activan en FASE 1 |
| `bun run build` | **exit 0** (los 4 commits — Next 16, prerender estático `/`) |
| `bunx knip` | **33 ítems (19 exports + 14 types) vs baseline 37 — SIN ítems nuevos**; los 4 `qa-obs-*.ts` son entries de `knip.json` (`scripts/qa-*.ts`) y `flags-ejemplo.json` no cuenta |

## 5 · Cómo probar esta rama HOY (sin el núcleo)

```bash
bun scripts/qa-obs-contract.ts     # → PENDIENTE NÚCLEO (FASE 0), rc 0
bun scripts/qa-obs-privacidad.ts   # → PENDIENTE NÚCLEO, rc 0
bun scripts/qa-obs-transporte.ts   # → PENDIENTE NÚCLEO, rc 0
bun scripts/qa-obs-ui.ts           # → PENDIENTE UI, rc 0
for f in scripts/qa-*.ts; do bun "$f" 2>&1 | tail -1; done   # 11/11 OK (7 viejos verdes + 4 PENDIENTE)
bash scripts/check-quality.sh      # gate completo: VERDE (los obs entran al glob con rc 0)
cat public/flags-ejemplo.json      # las 5 flags documentadas
# docs/CHECKLIST-CAMPO-observabilidad.md y docs/ENDPOINT-REPORTES.md listos para campo
```

## 6 · FASE 1 — lo que queda de este kit (instrucciones exactas)

Disparador: exista `origin/feat/obs-nucleo-v1` (agente 1 anuncia el push).

1. `git fetch origin && git rebase origin/feat/obs-nucleo-v1` sobre esta rama
   (o recrear desde ahí — los 4 commits de QA/docs son rebaseables con conflicto improbable:
   zonas disjuntas).
2. **A3-C1** `feat(obs): transporte de lotes con outbox propio (C1)`: reemplazar el cuerpo del
   stub `src/lib/e14/obs/transporte.ts` respetando §4.3 AL 100% — el QA ya congeló los valores
   (§3, último punto): outbox DB propio `e14-obs-outbox` v1 store `lotes` keyPath `id`;
   `iniciarTransporte()` idempotente no-op total sin endpoint; batcher 10 min ≤50 eventos de
   `leerEventos`; scrub por `leerPolitica()`; POST `{loteId, deviceId, appVersion, eventos[]}`;
   backoff 1m→5m→30m tope 3; kill local tras 3 fallos seguidos (`activo:false`, outbox intacto,
   `logger.warn`); TODO en try/catch silencioso, cero `console.*`. + tests vitest
   `obs/transporte.test.ts` (fake fetch): no-op sin endpoint · lote ≤50 y purga al éxito ·
   3 fallos → kill local · scrub respeta política. Al terminar: los 4 QA-obs pasan de
   PENDIENTE/rojo a VERDE (`38/38`, `7/7`, `8/8` — el de UI queda PENDIENTE hasta el agente 2).
3. **A3-C5** `feat(gate)`: `scripts/check-quality.sh` — (a) eliminar el comentario STALE de los
   «3 warnings deliberados» (verificado HOY: el texto está en las líneas 6-8 del header; desde
   PR #93 queda solo la 1 warning preexistente de logger.ts); (b) añadir los 4 nombres a
   `NOMBRES` en posición alfabética (…identidad-acta, **obs-contract, obs-privacidad,
   obs-transporte, obs-ui**, qr-identidad, watchdog-relectura) — el glob ya los incluye, solo
   faltan las etiquetas; (c) ANSI/códigos bien formados (lección audit #89). Ejecutar gate
   completo: 7 viejos 294/294 + obs verdes.
4. **A3-C6 cierre**: adaptar CHECKLIST-CAMPO si algo varió + REPORTE final con los conteos
   congelados + append final a `docs/worklog.md`.
5. Push. **El agente NO mergea** (dueño integra: núcleo → 2 y 3).

Si una ancla falla al integrar (agente 1 o 2 desviaron el contrato): **STOP en esa ancla** — no
editar el QA ni código ajeno; documentar en el REPORTE con archivo:línea y avisar al dueño (kit §Desviaciones).

## 7 · Pendiente/Bloqueado

- A3-C1 y A3-C5: bloqueados por `origin/feat/obs-nucleo-v1` (no existe al cierre de esta FASE 0).
- Anclas de UI (qa-obs-ui): se activan con `feat/obs-modo-dev-v1` del agente 2 (cualquier orden vs este branch).
- Verificación en campo de los 9 ítems: requiere núcleo + UI integrados (CHECKLIST §cabecera).
- Seguridad: el token GitHub usado para push estuvo expuesto en el chat — **regenerarlo** al cerrar la ola (ya figuraba como pendiente en worklog overnight).

---

# FASE 1 — ENTREGA FINAL (disparador cumplido: `origin/feat/obs-nucleo-v1` @ `7475625`)

## 8 · Ejecución de FASE 1

| Paso | Resultado |
|---|---|
| Rebase | Los 4 commits FASE 0 re-rebased sobre `feat/obs-nucleo-v1` @ `7475625` (kit §FASE 1, letra exacta). Conflicto único en `docs/worklog.md` (A1 y A3 añadieron bloque) resuelto **conservando ambos bloques** (protocolo README §5). NOTA de contexto: `main` @ `c6ecbcf` ya trae `feat/obs-modo-dev-v1` (PR #94) pero **NO trae el núcleo** (`obs/**` verificado ausente en `origin/main` — la UI del agente 2 llegó en su propia FASE 0 con `dev/puente.ts` local). Por eso la base correcta de esta rama sigue siendo `obs-nucleo-v1`, y el PR sale **stacked** (el dueño mergea 1º núcleo → este branch cae limpio). |
| A3-C1 | `5489d27` — transporte HTTP implementado + `transporte.test.ts` (9 tests) |
| Calibración | `831203b` — anclas QA-obs ajustadas al núcleo y a la UI REALES (§9 — intención preservada, evidencia file:línea) |
| A3-C5 | `d07bd0f` — check-quality.sh: STALE fuera + 11 QA en NOMBRES + conteos honestos |
| A3-C6 | este commit — REPORTE + worklog |

**Implementación A3-C1** (`src/lib/e14/obs/transporte.ts`): outbox PROPIO `e14-obs-outbox` v1
store `lotes` keyPath `id` (JAMÁS abre `e14-obs`) · `iniciarTransporte()` idempotente, no-op TOTAL
sin `endpointReportes` (cero timers/listeners, `{activo:false, lotesPendientes:0, fallosSeguidos:0}`) ·
batcher `BATCHER_MS = 10 * 60 * 1000` cosecha ≤ `LOTE_TOPE = 50` eventos **error/warn/salud/uso**
(perf NO viaja por red — llega por export manual) → lote `{id, ts, intentos:0}` → POST
`{loteId, deviceId, appVersion, eventos[]}` con **scrub previo por `leerPolitica()`**
(`depurarParaEnvio` puro y testeado) · backoff `BACKOFF_MS = [60_000, 300_000, 1_800_000]` por lote
(tope 3 intentos) · **kill local `FALLOS_KILL_LOCAL = 3`**: 3 fallos seguidos → autodetención
(`activo:false`), outbox INTACTO, un solo `logger.warn`; reactivación manual o por reinicio (el
arranque re-lee el outbox → «modo avión: envía al recuperar», checklist ítem 8) · semántica
at-least-once (el receptor deduplica por `evento.id`; los eventos no salen del buffer) · todo
try/catch silencioso, cero consola nativa.

## 9 · Calibración de anclas (lo que pidió el dueño) — intención PRESERVADA, evidencia file:línea

Al pasar de PENDIENTE a ESTRICTO se encontraron **3 bugs del propio harness FASE 0** y **4
realidades del código integrado** (desviaciones ya documentadas por A1/A2). Regla aplicada (kit
A3-C4 ⚠ / §Desviaciones): NUNCA editar código ajeno; el QA se ajusta a lo que el contrato
REALMENTE garantiza, cada ajuste con su justificación:

| # | Ancla | Antes (FASE 0) | Después (calibrado) | Evidencia |
|---|---|---|---|---|
| 1 | listarTs (contract/privacidad/ui) | `new URL(dir, import.meta.url)` resolviendo `scripts/src/…` → `[]` silencioso: las 6 anclas de claves §4.1 NUNCA evaluaron nada | prefijo `../` — los greps leen `src/lib/**` real | bug del harness (mío); claves verificadas presentes en `buffer.ts:22`, `politica.ts:18-20`, `identidad.ts:19` |
| 2 | firmas §4.3 | regex `export function` solo-sync → 6 grupos en rojo por funciones `async` | `export (async )?function` | `buffer.ts` (6 async), `uso.ts:60`, `dispositivo.ts:146`, `export.ts:117/225`, `flags.ts:107` |
| 3 | `ErrorBoundaryObs` | exigía `export const` | acepta `const\|class` | `captura.ts:150` — `export class ErrorBoundaryObs extends Component<…>` (mismo `React.ComponentType` del contrato §4.3) |
| 4 | `capturando` anti-recursión | lo buscaba en `captura.ts` | lo busca en `buffer.ts` con la desviación citada en la etiqueta | `buffer.ts:122` — A1 lo documentó («anti-recursión como guard de appendEvento — misma garantía, superficie mínima», REPORTE-obs-nucleo-v1 §4) |
| 5 | miniaturas gated en export.ts | heurística «toda mención de la palabra cerca de `politica`» — marcaba el NOMBRE del helper `miniaturasDeFallidas` (no es la ruta) | verifica la RUTA: la llamada a `miniaturasDeFallidas()` ocurre DENTRO de `if (…politica.miniaturas…)` | `export.ts:247-248` — gate real |
| 6 | toggles re-verificados en export.ts | exigía literales `textoOcr`/`miniaturas` en código | `leerPolitica()` real + gate de muestras; textoOcr es ESTRUCTURAL (ReporteSesion §4.2 no tiene campo de texto — doc de export.ts L18-20) | `export.ts:118` (llamada) + gate §5 |
| 7 | ResumenView sin INFORME ZIP (negativo) | grep sobre fuente cruda — la CABECERA documenta la migración en comentario → falso rojo | grep negativo sobre CÓDIGO (sin comentarios) | `ResumenView.tsx:13-15` comentario vs código limpio (verificado); el flujo vive en `PanelDev.tsx:250-260` |
| 8 | puerta del modo dev `aria-label` | exigía el literal concatenado `aria-label="Abrir modo de diagnóstico"` | exige binding + ambos nombres accesibles | `TuercaResumen.tsx:88` — `aria-label={modoDev ? "Abrir modo de diagnóstico" : "Activar modo de diagnóstico"}` |

**Hardening extra**: la ancla «actaId plano SOLO en captura.ts» ahora exige que `captura.ts` EXISTA
(pasaba en vacío si el archivo faltara) y elimina la única var sin uso del harness → lint 0 warnings.

**Validación de las anclas UI (8) contra la UI REAL del agente 2**: worktree de `origin/main`
@ `c6ecbcf` (que ya trae `dev/**`) + script calibrado → **8/8 OK**. Al mergear esta rama sobre
main, `qa-obs-ui` nace ESTRICTO y VERDE (el gate de main no se rompe).

## 10 · Gate FASE 1 (por commit, contra el árbol commiteado)

| Gate | Resultado |
|---|---|
| `bunx tsc --noEmit` | **0 errores** |
| `bun run lint` | **0 errores / 0 warnings** (la de logger.ts la eliminó A1; la única var sin uso del harness, corregida aquí) |
| `bun run test` | **162/162** (70 base + 83 obs/flags del núcleo + **9 transporte** nuevos) |
| QA 7 viejos | **294/294 INTACTO** (33+50+24+49+32+72+34) |
| QA obs ESTRICTO | **contract 38/38 · privacidad 7/7 · transporte 8/8** · ui PENDIENTE rc=0 (se activa al integrar; 8/8 vs main verificado — §9) |
| `bash scripts/check-quality.sh` | **TODO VERDE — QA 11/11** |
| `bun run build` | **exit 0** (Next 16, prerender estático) |
| `bunx knip` | **40 ítems (23 exports + 17 types) vs 42 del estado FASE 0 — SIN ítems nuevos, neto −2** (los exports del transporte nacen con consumidor: `page.tsx` bootstrap + tests) |

## 11 · Cómo probar esta rama

```bash
bun scripts/qa-obs-transporte.ts   # 8/8 OK (ESTRICTO — contra la implementación real)
bash scripts/check-quality.sh      # TODO VERDE — QA 11/11
bunx vitest run src/lib/e14/obs/transporte.test.ts   # 9 tests (fake IDB + fake fetch + fake timers)
```

Prueba manual del transporte (endpoint real, en DevTools del build servido):
```js
// 1) configurar el endpoint (override manual del dueño — D6) y recargar:
localStorage.setItem("e14-flags-overrides",
  JSON.stringify({ endpointReportes: "http://localhost:9999/reportes" }));
// 2) receptor mínimo en otra terminal:  nc -l -p 9999   (o docs/ENDPOINT-REPORTES.md §receptor)
// 3) provocar un error en la app → iniciarTransporte ya corre en el bootstrap →
//    el lote sale en el siguiente tick (o al recargar: backlog). Estado:
import("/src/lib/e14/obs/transporte.ts").then((m) => console.log(m.estadoTransporte()));
// → { activo: true, lotesPendientes: 0, fallosSeguidos: 0 } tras el éxito
// 4) tumbar el receptor 3 ticks → autodetención con outbox intacto + logger.warn
```

## 12 · Pendiente (post-merge)

- El dueño mergea: **1º `feat/obs-nucleo-v1` → luego este branch** (caerá limpio; `qa-obs-ui`
  nace ESTRICTO 8/8 contra main — verificado con worktree §9).
- El FASE 1 del agente 2 (delegar `dev/puente.ts` a los módulos reales — incluido
  `estadoTransporte()` en su panel) queda para su propio disparador; las firmas del contrato
  ya existen y están congeladas por `qa-obs-contract.ts`.
- Verificación en campo de los 9 ítems del CHECKLIST-CAMPO (requiere núcleo + UI integrados).
- **Seguridad: REGENERAR el token GitHub** (expuesto en chat — pendiente permanente).
