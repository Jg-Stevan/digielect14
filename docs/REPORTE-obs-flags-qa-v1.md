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
