# REPORTE — e14-main-d65-d66-reconciliacion-v1 (FIX-1)

**Fecha:** 2026-10-20 · **Base:** `main` = `1a5b203` (merge #57) · **Rama:** `fix/e14-main-d65-d66-reconciliacion-v1` · **PR:** DRAFT hacia `main`

## 1. Veredicto (una línea)

El merge de PR #57 (D66, base pre-D65) resolvió mal los conflictos contra main@`eedb18e` (D65) y dejó `main` **SIN COMPILAR** (29 errores tsc) pisando/adaptando mal bloques ADITIVOS de dos kits ya mergeados — esta reparación reconstruye la resolución correcta sin cambiar NINGÚN comportamiento por fuera de lo que ambos kits ya definieron.

## 2. Evidencia (reproducible)

| # | Hecho | Comando |
|---|-------|---------|
| E1 | main `1a5b203` = 29 errores tsc (17 informe, 10 runner, 2 store) | `bunx tsc --noEmit` en `1a5b203` |
| E2 | Ambos padres del merge compilaban 0 errores | `git checkout eedb18e` → tsc 0 · `git checkout 03a5de2` → tsc 0 |
| E3 | El daño nació en la resolución de conflictos `cd6a3b5` ("Merge branch 'main' into feat/e14-decode-unico-precalor-v1") | topología: `eedb18e` (D65 a main) + `03a5de2` (D66) → `cd6a3b5` → `1a5b203` |
| E4 | `tipos.ts` NO figuró en el diff del merge (`03a5de2→1a5b203` solo toca 6 archivos; tipos ausente) → bloque D65 (T1.4/T2.3) entero ausente | `git diff 03a5de2 1a5b203 --stat` |
| E5 | En `informe.ts` cada bloque D65 (FilaInforme L112-128, filaLiviana, actaLivianaJson, TOTALES COLGADAS+DEDUP v2) fue REEMPLAZADO por su homólogo D66 | `git diff eedb18e 1a5b203 -- src/lib/e14/informe.ts` (pares `-D65 +D66`) |
| E6 | En `runner.ts` el cuerpo lineal pre-D65 (D66) quedó empalmado con el loop del watchdog (D65): `const veredictoOrigen` + `let veredictoOrigen` duplicados, `setState({etapa:"DETECTANDO"})` viejo, refs muertas `progresoThrottled`/`TIMEOUT_MASIVA_MS`/`archivoPredecode` | errores tsc TS2451/TS2304/TS2322 de `cd6a3b5` |
| E7 | La resolución BORRÓ la entrada D65 completa de `docs/worklog.md` (existente en `eedb18e`, 16 líneas) reemplazándola por la de D66 | `git show eedb18e:docs/worklog.md` vs main |
| E8 | Marcadores `=======` huérfanos del merge #46 sobrevivían en DECISIONS.md:62 y AGENTS.md:71 (los `<<<<<<<`/`>>>>>>>` ya limpiados por otra sesión) | `grep -n "^=======$"` |

## 3. Principio de la reconstrucción

D66 se implementó sobre `2483c42` (SIN D65 — desviación documentada en su PR) y el owner lo mergeó DESPUÉS de que D65 estuviera en main. La resolución correcta de ese merge es la **composición de ambos kits**, que son disjuntos por diseño (D65: watchdog/dedup v2/señal de vida; D66: master único/precalor) salvo por el mismo ancla (`opcionesMasiva`/bloque D63). Reglas aplicadas:

1. **Base = D65 limpio** (`eedb18e`, 0 errores) porque D65 re-estructuró `procesarUno` (loop de intentos); los deltas D66 se re-aplican encima.
2. **D63-A/B (bloques ajenos)** corren SIEMPRE sobre el ORIGINAL del intento (EXIF/márgenes — invariante D66) y DENTRO del loop del watchdog (D65 — el reintento los re-ejecuta con workers frescos).
3. **El pipeline consume SIEMPRE un MASTER** (D66 T1): intento 1 = precalentado u horneado del original; REINTENTO = re-horneado con `maestroDeImagen` desde el File FRESCO del registro (instancia sin veneno en la decodeMemo por-instancia — D65 T1.2); si el re-horneado falla → original fresco (AC-P3).
4. **Trazas D66 T4 del DESENLACE**: describen al master que produjo el acta final — si el desenlace vino de un re-horneado del reintento, `precalentada:false` y `precalorMs` omitido (jamás atribuir al precalor un decode que no llegó).
5. **Prefetch D61 re-apuntado** a `asegurarMaestro` (D66): `prefetchSlot`/`precargarDecodeArchivo`/`procesarUno(fila, predecode)` fuera — no quedaba consumidor.
6. **`tipos.ts`**: bloque D65 al FINAL de `RegistroMasiva` (append-only, contrato D57).
7. **`informe.ts`**: bloques D65 restaurados DELANTE de los D66 — ambos kits añaden al final de la MISMA sección; D65 llegó primero a main, D66 se apila después (orden estable, parsers por prefijo a salvo).

## 4. Cambios (3 código + 5 docs)

| Archivo | Cambio |
|---|---|
| `src/lib/e14/masiva/runner.ts` | Reconstrucción = D65 + deltas D66 (hunks 1-9 del delta puro `2483c42→03a5de2`), con las fusiones de la §3 |
| `src/lib/e14/masiva/tipos.ts` | Bloque D65 restaurado al final de `RegistroMasiva` (5 campos opcionales) |
| `src/lib/e14/informe.ts` | 4 bloques D65 restaurados (FilaInforme, filaLiviana, actaLivianaJson, TOTALES) conviviendo con D66 |
| `docs/worklog.md` | Entrada D65 restaurada BYTE A BYTE desde `eedb18e` + entrada de esta reparación |
| `docs/DECISIONS.md` | Fila FIX-1 + marcador huérfano L62 eliminado |
| `docs/ROADMAP.md` | Sección REPARACIÓN MERGE #57 |
| `AGENTS.md` | Línea de registro + marcador huérfano L71 eliminado |
| `docs/REPORTE-e14-main-d65-d66-reconciliacion-v1.md` | Este reporte |

## 5. Validación

- **tsc:** 0 errores (antes 29) — `bunx tsc --noEmit`.
- **lint:** 0 — `bun run lint`.
- **build:** OK — `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bun run build` (estático prerenderizado).
- **Sin refs muertas:** `prefetchSlot`/`predecode`/`precargarDecodeArchivo`/`setState DETECTANDO` ausentes; los `DETECTANDO` restantes son el vocabulario legítimo de `etapaDeSenal` (mapeo D65 de señales del bridge).
- **Diff acotado:** `git diff main --stat` = EXACTAMENTE los 3 archivos rotos + docs.
- **Pendiente del dueño (humo real):** la validación §3 de D65 (gemelos heic/jpg, colgado con reintento, señal de vida) y el A/B de D66 (16/16 veredictos corrida 162728 ±0.3) requieren el lote/hardware del dueño — no repetibles en sandbox; la reparación no cambia NINGÚN criterio de veredicto, así que ambos gates del dueño siguen siendo los mismos de los PRs #56/#57.

## 6. Qué NO se tocó

Zonas ajenas intocadas: bridge (`scanner-core-bridge.ts`), `types.ts` del flujo, `archivos.ts`/`precalor.ts`/`dedup.ts`/`store.ts`/`MasivaView.tsx`/`rapidocr.ts` (ya correctos en main), SIM, chips congelados (8.2/7.0/4.3), criterios/score del veredicto, `public/**`, `src/assets/**`, `packages/**`. La variable muerta `archivoCorregido` de D63-B (hallazgo D65/D66, decisión del dueño) sigue sin activar.

## 7. Verificación de los kits ya mergeados (esta sesión, sin duplicar)

- **D63-D rev.2 (PR #55)** — T1/T1b/T2/T2b presentes y conformes en `informe.ts` (origenSenales SIEMPRE incluso con origen null; JSON por-acta; ESCANEOS extendida; ORIGEN con detalle del null por señal dominante).
- **D65 (PR #56)** — T1 (75 s × 2, re-creación de workers, etapaAlMorir/elapsedMs), T2 (EXIF from-image, DEDUP_HAMMING_MAX=6, trazas), T3 (marcarProgreso 250 ms, EN COLA #N de M, OCR % real, a11y), T4 (nota de espera, COLGADAS, DEDUP v2) — todas presentes; el único defecto era el estado del merge, no su código.
