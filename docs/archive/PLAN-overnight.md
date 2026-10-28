# PLAN OVERNIGHT — 2026-10-22

> Rama: `audit/overnight-20261022` (creada desde `audit/quality-pass-1`, según instrucciones).
> Límites duros: **20 commits / 6 h** (el commit de este plan no cuenta).
> Gate tras CADA commit: `tsc --noEmit` (0 err) + `lint` (0 err) + `build` (exit 0) + **7 QA** (280/280).

## Estado inicial verificado (baseline)

| Gate | Resultado |
|---|---|
| `bunx tsc --noEmit` | ✅ 0 errores |
| `bun run lint` | ✅ 0 errores / **3 warnings deliberados** (`recienListas`, `posCola`, `modoMenuMontado` — §2.1) |
| `bun run build` | ✅ exit 0 (Turbopack, standalone) |
| 7 QA (`scripts/qa-*.ts`) | ✅ **280/280** (33+42+24+49+30+68+34) |
| `bunx knip` | **72 ítems** (35 exports + 37 types) — baseline de comparación |

⚠️ **Advertencia de divergencia**: `main` avanzó con e70/e71/e72 (PRs #86-#88) que NO están en
`audit/quality-pass-1`. El PR de esta noche (base `main` · head overnight) mostrará también los
24 commits de quality-pass-1. La reconciliación es decisión del dueño (no toco `main`).

## 🟢 Tareas autónomas (ejecutar esta noche, en orden)

Cada tarea: grep de evidencia → QA antes → commit atómico → gate completo → QA después →
actualizar AUDIT.md. knip diferencia **borrado** (sin uso, ni interno) vs **de-export**
(export muerto, uso interno vivo).

| # | Tarea | Archivos | Acción | Riesgo | Gate QA |
|---|-------|----------|--------|--------|---------|
| 1 | 3B-B1a iconos huérfanos | `icons.tsx` | BORRAR 7 iconos base (`ArrowLeftIcon`,`CloudCheckIcon`,`GridIcon`,`CropIcon`,`ImportIcon`,`EyeIcon`,`BoltIcon`) — los componentes usan las variantes `Stitch*`; grep: 0 uso en scripts/, 0 uso interno. 🔒 `StitchFrameIcon` EXCLUIDO (decisión menú §6.3) | Bajo | tsc+lint+build+7QA |
| 2 | 3B-B1b tipos puros | `types.ts` | BORRAR `ActaCandidato`/`MesaEstado`/`PaginaEstado` (0 uso interno); de-export `ActaUbicacion` (uso interno L184) | Bajo | idem |
| 3 | 3B-B1c primitives | `primitives.tsx` | BORRAR `StatusDot` + `toneDot` + `toneText` (quedan huérfanos internos); de-export `Tone` (uso interno L46/L86) | Bajo | idem |
| 4 | 3B-B2a deskew | `masiva/deskew.ts` | DE-EXPORT `detectarSkew`/`puntoBlanco`/`normalizarPuntoBlanco` — uso interno vivo en `preProcesoEscaneo` (L303/308/326); ajustar comentario L27 | Bajo | idem |
| 5 | 3B-B2b cola | `masiva/cola.ts` | DE-EXPORT `abrirCola` — 7 usos internos; QA solo lo cita en comentario propio (L110 qa-historico), NO es ancla de fuente | Bajo | idem |
| 6 | 3B-B3a informe | `informe.ts` | DE-EXPORT `resumenColgadas` (uso interno L945) + 4 types `EntornoInforme`/`ResumenInforme`/`ProgresoInforme`/`InformeZip` (uso interno L480/224/880/881) | Bajo | idem |
| 7 | 3B-B3b orientacion | `orientacion.ts` | DE-EXPORT `PROBE_BUDGET_MS`/`MARGEN_ORIENTACION`/`PROBE_K_CROPS` (uso interno L259/287/323) + `Rotacion`/`ProbeOrientacion` (L66-71/255). Grep: 0 QA grepea orientacion.ts (umbrales 0.82/0.6/0.55 viven en clasificador.ts) | Bajo | idem |
| 8 | 3B-B3c divipol | `divipol.ts` | DE-EXPORT 4 types (`DivipolPuesto`/`DivipolNodo`/`RutaDivipol`/`EstadoDivipol`, uso interno); **CONSERVAR** `mesaValida`+`buscarPuestosPorNombre` (funcs puras que Prioridad 2 testa — tests = consumidor legítimo) | Bajo | idem |
| 9 | Vitest setup | `package.json`(devDeps), `vitest.config.ts`, `knip.json` | AÑADIR `vitest` (devDependency — R4 lo permite); config con entorno node (funcs puras); knip entries `**/*.test.ts` | Bajo | tsc+lint+build+7QA+vitest |
| 10 | Tests clasificador | `clasificador.test.ts` | `normalizarNombre`, `similitud`, `tipoDeDigito`, `candidatosCodigo1D` — happy path + edges. NO tocar la lógica | Bajo | idem |
| 11 | Tests completitud | `completitud.test.ts` | % completitud con datos mock | Bajo | idem |
| 12 | Tests divipol | `divipol.test.ts` | lookup con base mock: `departamentosDe`/`municipiosDe`/`zonasDe`/`puestosDe`/`mesasDePuesto`/`mesaValida`/`buscarPuestosPorNombre` | Bajo | idem |
| 13 | Helper logger | `src/lib/logger.ts` (NUEVO) | `debug`/`info` gate `NODE_ENV !== "production"`; `warn`/`error` siempre | Bajo | idem |
| 14 | Migrar dedup | `masiva/dedup.ts` | `console.*` → `logger` | Bajo | idem |
| 15 | Migrar historico | `masiva/historico.ts` | idem | Bajo | idem |
| 16 | Migrar cola | `masiva/cola.ts` | idem (verificar cuántos hay) | Bajo | idem |

> Si tras la tarea 8 algo no está 100% verde → STOP P1, saltar a P2 (regla del prompt).
> NO migrar `runner.ts` (22 console) — es de otra fase. `scanner-core-bridge.ts` fuera de alcance.

## 🟡 Tareas con cuidado

| # | Tarea | Condición para ejecutar | Rollback |
|---|-------|-------------------------|----------|
| — | De-exports en firma pública (`RutaDivipol` en firma de `mesaValida`) | TS permite tipos no exportados en firmas exportadas con `--noEmit`; verificado por tsc del gate | `git revert HEAD` |

## 🔒 Bloqueadas (NO tocar — documentar en AUDIT.md)

| Símbolo/Área | Razón |
|---|---|
| `StitchFrameIcon` (icons.tsx) | Decisión menú §6.3/D65 → dueño (AUDITORIA #7: borrar o conservar según reviva el menú) |
| `borrarHistorico` (historico.ts) | **ANCLA QA POSITIVA**: qa-historico-enviadas L127 exige `export async function borrarHistorico` + RL-e65b-5 (helper deliberado sin cablear) |
| `dhash64DeDataUrl` (dedup.ts) | Red line VIVA en qa-qr-identidad L453 (regex que prohíbe hashes en informe) — ancla blanda, conservador |
| `identidad-qr.ts` (7 ítems), `archivos.ts` (4), `precalor.ts` (2), `store.ts` (3), `masiva/store.ts` (2), `scanner-core-bridge.ts`, `rapidocr.ts`, `AyudaOverlay.tsx`, resto de types sueltos | Fuera de la lista 3B del plan overnight (módulos grandes / zona de ciclos store↔precalor↔runner / wasm) |
| `recienListas`/`posCola`/`modoMenuMontado` (3 warnings lint) | Decisiones B1/B2 D65 → dueño (re-cablear o remover, jamás de noche) |
| `wasm.proxy`, `reactStrictMode`, `next.config.ts`, `eslint.config.mjs`, ciclos de imports | R4 del prompt — bloqueado permanente |

## Criterio de éxito

- 16 commits atómicos (≤ 20), cada uno con gate 4/4 verde
- 0 regresiones en QA (280/280 al final)
- Build size igual o menor
- knip: 72 → esperado ~45-50 (borrados 12 + de-exports ~17 + ítems "revividos" por tests excluidos del reporte)
- 3 archivos de tests, sin tocar lógica de src/
- MORNING-REPORT.md + PR abierto (sin merge) + worklogs actualizados
