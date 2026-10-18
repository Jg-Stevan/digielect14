# REPORTE e14-limpieza-tests-v1 — fuera los QA harnesses anteriores (+ lab muerto)

> Rama `chore/limpieza-tests` (base `main @ cdf05e7` — PR #20 mergeado) · **PR #21** ·
> Ejecutado por Z.ai Code el 2026-10-18 · Fase A + Fase B1 (opción recomendada del kit).

## §0 Mandato del dueño (verbatim)

> *«bro ahora tenemos que quitar los test anteriores, genera el plan»*

Alcance interpretado por el kit §0: Fase A = los 3 QA harnesses (mandato directo);
Fase B = el `lab/` muerto (decisión del dueño — al no indicar B2 antes de ejecutar,
corrió la opción **B1 recomendada**).

## §1 Mapa de los 3 harnesses (qué eran, para el registro)

| Archivo | Kit que lo creó | Qué verificaba | Último estado |
|---|---|---|---|
| `scripts/qa-codigo-unico.ts` | identificacion-codigo-v1 (PR #8) | 12 códigos de cédula + 3 negativos (código 1D / unicidad) | 15/15 |
| `scripts/qa-consenso.ts` | consenso-frankfurt-v1 (PR #9) | AC1-AC5: código único, consenso kit, mesa DIVIPOL, `marcasEsquina` adaptativa, `verificarCompletitud` | 29 OK |
| `scripts/qa-lectura-perdona.ts` | lectura-perdona-lazo-v1 (T-A, PR #16) | 10 casos §5 del lazo perdonado por lectura | 13/13 |

Eran QA headless **FUERA del bundle** (`bun scripts/qa-*.ts`) de kits ya mergeados y
aceptados en campo; el último kit los actualizó (`ca9f170`). Su valor histórico vive en
`docs/REPORTE-*.md` y en la historia de git (blobs accesibles por SHA — NO se reescribe).

## §2 Decisión B1/B2

**B1** (default del kit al no haber instrucción del dueño): fuera el rig
FILTROS-1/quad-repro BLOQUEADO desde 2026-10-17 (fotos de campo perdidas con el
reinicio del sandbox — ~6.7 MB) + `lab/fixtures` (3 fotos reales de actas E-14 fuera
de HEAD — repo público); **se conservan `lab/resultados/`** (5.3 MB citados por ruta
relativa en 10 docs: quad-repro, luz-sim-puntos, esquinas-suaves §EV) y `lab/README.md`
se reemplazó por el stub «SOLO EVIDENCIAS HISTÓRICAS». `lab/` queda con EXACTAMENTE
2 entradas: `README.md` + `resultados/`.

**Desviación justificada (1 archivo extra):** `lab/vendor` (symlink → `../public/vendor`,
opencv/onnxruntime que SOLO consumía `ocr_engines.py` del rig) también se retiró — sin
él `lab/` no quedaría en las 2 entradas que §Fase B exige. `public/vendor` NO se tocó
(fuera de alcance del kit).

## §3 Verificación (§ACEPTACIÓN del kit)

| Chequeo | Resultado |
|---|---|
| `ls scripts/` | **exactamente `gen-divipol.mjs`** ✓ |
| `grep -rn "qa-" scripts/ src/ package.json .github/` | **0 hits** ✓ |
| `bunx tsc --noEmit` | **0 errores** (scope solo se encoge) ✓ |
| `bun run lint` | **0 errores, 0 warnings** tras B1 (el único warning vivía en `lab/quad-repro.js`) ✓ |
| CI `Quality Gate` (tsc + lint + build estático) @ `a1de3a6` | **success** ✓ |
| CI `Worker parity` @ `a1de3a6` | **success** (worker sin diff — pasó solo) ✓ |
| Smoke app | nada de producción cambió — build del CI es el smoke; app idéntica ✓ |

## §4 `git diff --stat main..HEAD` (cero producción — congelados ❄️ respetados)

```text
 AGENTS.md                                 |   3 +-
 docs/REPORTE-e14-limpieza-tests-v1.md     |  60 ++++++
 docs/worklog.md                           |  13 +
 lab/.gitignore                            |   7 -
 lab/README.md                             |  38 +-
 lab/bench.py                              |  ...
 lab/crop_acta.py · filtros_app.py · ocr_engines.py · laminas.py
 lab/quad-repro.{js,html} · reporte.py · run_filtros1.sh
 lab/scanner-core-0.4.0.bundle.js · setup_env.sh · variantes.py · zip_pack.py
 lab/vendor (symlink) · lab/gt/gt.py · lab/worker-copy/detection-worker.js
 lab/fixtures/{README.md, acta-e14-real.jpg, mesa-00{1,2}-original.jpg}
 scripts/qa-codigo-unico.ts                | 100 --
 scripts/qa-consenso.ts                    | 420 ------
 scripts/qa-lectura-perdona.ts             | 152 --
 25 files changed, +insertions mínimos (registro) / −7647 líneas
```

NINGÚN archivo de `src/`, `public/`, `packages/`, `bun.lock`, `package.json` ni
`.github/workflows/*`. `bun.lock`/`package.json` SIN DIFF en todo el kit.

## §5 RIESGOS Y LÍMITES (lo que este kit NO hace)

- No reescribe historia git (blobs de fotos y harnesses siguen accesibles por SHA).
- No añade tests nuevos: desde este kit la evidencia QA vuelve a capturas de
  navegador + trazas `[e14]` pegadas en el PR (sin harness). QA automatizado de
  nuevo = kit aparte con decisión propia.
- No toca `gen-divipol.mjs` (infraestructura de datos DIVIPOL), ni workflows, ni
  menciones en docs históricos (historia — solo se AÑADE registro nuevo).

## §6 Commits

`18be892` Fase A (3 qa-*.ts fuera, −672) · `a1de3a6` Fase B1 (rig fuera, +stub README,
−6975) · (este registro docs) — **1 PR: #21**.
