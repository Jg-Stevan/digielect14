# REPORTE OVERNIGHT — 2026-10-22 (noche del 22→23)

> Rama: `audit/overnight-20261022` (creada desde `audit/quality-pass-1`, según instrucciones).
> Plan ejecutado: `PLAN-overnight.md` (commit `233600f`). Detalle completo: `AUDIT.md §6`.

## Estado

| Métrica | Valor |
|---|---|
| Commits | **12 de 20** (+1 del plan, que no cuenta) |
| Tiempo agéntico | ~45 min efectivos (23:24 → 00:11 BOG) — muy por debajo del límite de 6 h |
| QA regresión | **280/280** (33+42+24+49+30+68+34) — verde en CADA commit |
| Vitest (nuevo) | **53/53** — 3 archivos, 53 casos, cero cambios de lógica |
| Build size | **Idéntico**: chunks 4.071.439 B vs 4.071.441 B (−2 B, ruido de hash) · standalone 62.016 KB = |
| Dead code (knip) | **72 → 37 ítems** (−35) — los 37 restantes son 🔒 bloqueados o módulos grandes fuera de alcance |
| Reverts | **0** (un borrado mal clasificado lo cazó el gate tsc ANTES de commitear — corregido a de-export en el mismo commit) |
| Tareas fallidas (3 intentos) | **0** |

## Tareas completadas ✅

| # | Tarea | Commit | Verificado |
|---|---|---|---|
| 1 | 3B-B1a icons.tsx — 7 iconos base huérfanos BORRADOS (variantes Stitch* intactas) | `528b54d` | gate 4/4 + QA antes/después |
| 2 | 3B-B1b types.ts — de-export 4 tipos (uso interno) | `1d49bc1` | gate 4/4 |
| 3 | 3B-B1c primitives.tsx — StatusDot borrado, Tone de-export | `f0494c6` | gate 4/4 |
| 4 | 3B-B2a deskew.ts — de-export 3 funciones puras (uso interno en preProcesoEscaneo) | `036d465` | gate 4/4 |
| 5 | 3B-B2b cola.ts — de-export abrirCola (7 usos internos) | `124a884` | gate 4/4 |
| 6 | 3B-B3a informe.ts — de-export 5 símbolos (uso interno) | `2aab064` | gate 4/4 |
| 7 | 3B-B3b orientacion.ts — de-export 5 símbolos (ningún QA grepea el archivo) | `d953f7d` | gate 4/4 |
| 8 | 3B-B3c divipol.ts — de-export 4 tipos; mesaValida/buscarPuestosPorNombre conservadas (bajo test) | `2c1a15d` | gate 4/4 |
| 9 | **Vitest + suite unitaria** (clasificador 23 · completitud 10 · divipol 20) | `ad8fde9` | vitest 53/53 + gate 4/4 |
| 10 | logger.ts (política única) + migra divipol.ts | `12ca597` | gate 4/4 |
| 11 | AUDIT.md §6 — consolidado con estados y evidencias | `1494cf3` | — (docs) |
| 12 | scripts/check-quality.sh — gate único versionado | `3fbccd6` | ejecutado end-to-end ✅ |

## Tareas bloqueadas 🔒 (requieren tu OK)

| Tarea | Razón | Requiere |
|---|---|---|
| `StitchFrameIcon` (icons.tsx) | Decisión menú §6.3/D65 (AUDITORIA-REGRESION #7) | Tu decisión: borrar o conservar si revives el menú |
| `borrarHistorico` (historico.ts) | **ANCLA QA POSITIVA** (qa-historico L127 exige el export) + RL-e65b-5 helper deliberado | Cablear UI o decisión Fase 4 |
| `dhash64DeDataUrl` (dedup.ts) | Red line VIVA en qa-qr-identidad L453 (regex anti-hashes en informe) | Revisar el QA antes de tocar |
| `identidad-qr.ts` (7 ítems), `archivos.ts` (4), `precalor.ts` (2), `store.ts` (3), `masiva/store.ts` (2), `scanner-core-bridge.ts` (1), `rapidocr.ts` (2), `AyudaOverlay` (1), `QuadEditor` (1) | Fuera de la lista 3B del plan (módulos grandes / zona de ciclos store↔precalor↔runner / wasm) | Fase 4, módulo por módulo con protocolo |
| `recienListas`/`posCola`/`modoMenuMontado` (3 warnings lint deliberados) | Decisiones B1/B2 D65 (§2.2 AUDIT) | (a) re-cablear D65 T3.3 o (b) remover cadena + gate QA |
| Ciclos de imports, `wasm.proxy`, `reactStrictMode`, `next.config.ts`, `eslint.config.mjs` | R4 del prompt — bloqueo permanente | Diseño + tu aprobación |

## Tareas fallidas ⚠️ (3 intentos)

**Ninguna.**

## Tests añadidos

- 3 archivos `*.test.ts` al lado del código (sin tocar lógica): `clasificador.test.ts` (23 casos), `completitud.test.ts` (10), `divipol.test.ts` (20).
- Casos con evidencia real del repo: informe 120553 (CALRO/CAIRO→0), Frankfurt §0-F4 (/1000/453010202→710007453010202), encuadre 0.998 del dueño (§1c), perdón 4/4 fiduciales, regla 5 de mesa (1..countTable).
- Limitación honesta (header de completitud.test.ts): densidades 20%/85% y perdón POR LADO requieren canvas real → tu validación runtime.
- `npm run test` (vitest run) + `bash scripts/check-quality.sh` corren todo.

## ⚠️ Advertencias para el humano (LEER ANTES DEL MERGE)

1. **El PR incluye 24 commits de `audit/quality-pass-1`** (la rama base pedida) + los 12 de esta noche. El tramo quality-pass-1 ya lo conoces; los overnight son los 12 listados arriba.
2. **`main` avanzó mientras tanto** (e70/e71/e72, PRs #86-#88) y NO está en esta rama. Al abrir el PR base `main` verás la diferencia completa; posibles conflictos con los de-exports en los archivos que e70-e72 tocaron (orientación/dedup/masiva). La reconciliación es decisión tuya — no toqué `main`.
3. **El token de GitHub quedó expuesto en el chat** — **REGENÉRALO** después de revisar el PR.
4. **Smoke test manual NO realizado por el agente** (sin browser en sandbox): subir 1 acta por MASIVA y verificar cola + el menú de modo sigue igual. Los 280 QA + 53 unit + build verde son la mejor cobertura disponible, pero no sustituyen tus 5 minutos de cámara.

## Recomendaciones para el humano (en orden)

1. Leer este reporte + `AUDIT.md §6` (5 min).
2. Verificación independiente:
   ```bash
   git checkout audit/overnight-20261022
   bash scripts/check-quality.sh   # tsc + lint + build + vitest + 7 QA + knip
   ```
3. Smoke test manual (5 min): `bun run dev` → subir 1 acta → cola procesa → menú de modo OK.
4. Revisar el PR commit por commit (los 12 overnight son atómicos con evidencia en cada mensaje).
5. Decidir los 🔒 de §6.4 de AUDIT.md (StitchFrameIcon, D65 B1/B2, módulos grandes Fase 4).
6. Merge normal (preserva arqueología) o pedir cambios.

## Comandos para verificar tú mismo

```bash
git checkout audit/overnight-20261022
bunx tsc --noEmit && bun run lint && bun run build
bun run test            # vitest 53/53
for f in scripts/qa-*.ts; do bun "$f"; done   # 280/280
bunx knip               # 37 ítems (desde 72)
bun run dev             # smoke test manual
```

## ⏸️ TAREAS PENDIENTES (planificadas, NO ejecutadas)

- **Prioridad 5 del plan**: Playwright smoke test (1-2 flows browser) — NO instalado (browser download pesado en sandbox + riesgo nocturno); `check-quality.sh` sí quedó versionado.
- Migración console→logger de los módulos GRANDES (runner 22, rapidocr 5, masiva/store 4, …) — explícitamente fuera de alcance por el plan ("otra fase").
- 3B-B4 (si existía en tu cabeza como tanda de módulos grandes) — la lista 3B del plan terminaba en B3.
- `normalizarCodigo` (clasificador.ts, knip-muerto) — fuera de la lista P2 de 4 funciones; candidato a test o borrado en Fase 4.
