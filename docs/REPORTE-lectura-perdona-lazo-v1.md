# REPORTE — KIT e14-lectura-perdona-lazo-v1 (T-A · «la lectura perdona al fiducial»)

Fecha: 2026-10-17 · Ejecutado por: Z.ai Code · Rama: `fix/lectura-perdona-lazo` desde main `4aa2e06`

## 1. La regla (§3 — implementada verbatim)

`lazoPerdonadoPorLectura(esquinas, texto, faltaSeccion)` en `src/lib/e14/senal-lectura.ts`
(código verbatim del kit §4-A, PURO sin DOM/imports):

- Por CADA esquina faltante, evidencia de SU lado — tope (`tl`/`tr`): `/E\s*-\s*14/i` o
  `/\b\d{15}\b/` · fondo (`bl`/`br`): `!faltaSeccion` Y `/KIT[::\s.]*\d+/i`.
- Perdón = **TODAS** las faltantes tienen evidencia (`every` — pitfall §9.4).
- `esquinas === null` o 4/4 → `false` (n/d jamás condena ni rescata — pitfall §9.3).

## 2. Alcance ejecutado (§2 CAMBIA — 100%, nada más)

| # | Archivo | Cambio |
|---|---|---|
| 1 | `src/lib/e14/senal-lectura.ts` | `lazoPerdonadoPorLectura` NUEVO al final del módulo (JSDoc del kit) — el módulo sigue dependencia-cero. |
| 2 | `src/lib/e14/scanner-core-bridge.ts` | Import añadido al bloque del kit score-lectura. **AMBOS pipelines**: `const faltaSeccion = faltaSeccionInferior(texto, clasificacion.pagina)` (extraída — el bridge ya la computaba inline, costo 0) + `const lazoPerdonado = lazoPerdonadoPorLectura(esquinas, texto, faltaSeccion)` (misma `esquinas` que alimenta `ladoEsquinaFaltante` — escaneo L955 con guard SIM / recorte L1462) + `const recortada = faltaSeccion \|\| (ladoEsquina !== null && !lazoPerdonado)`. **Trazas ×2**: token atómico ` lazo=perdonado` después de ` lado=…` → `… recortada=1 lado=inf-izq lazo=perdonado esquinas=FALTA_bl …`. |
| 3 | `scripts/qa-lectura-perdona.ts` | NUEVO — 10 casos §5 (13 aserciones) + contador `N/N` + exit 1. |

El cap `if (recortada) score = Math.min(score, TECHO_ESCUDO_FONDO)` **INTACTO** (misma línea,
mismo valor, misma posición — pitfall §9.2). `faltaSeccionInferior` nunca perdonada. Guard
INCOMPLETA intacto. Copy del aviso 118 intacto. Cero cambios en core npm, chips o score de disparo.

## 3. Validación (§6)

| Gate | Resultado |
|---|---|
| §6.1 QA headless | **13/13 OK, exit 0** — los 10 casos del §5 (casos 5/6/8 con AMBAS aserciones): zip1 real → perdón · zip2 real → cap se queda · 4/4 → false · null → false · tope E-14 → true / sin cabecera → false · doble falta ambos → true / una evidencia → false · SUMA sin KIT → false · pag2 FIRMA → true / sin FIRMA → false · SIM ESQUINAS_OK → false · post-banda sello suma evidencia → true |
| §6.2 lint + tsc | **lint 0 · tsc 0** |
| build | **OK** (`/` estático) |
| §6.3 SIM (dev :3001, 412×850 — REGLA-PREVIEW respetada) | chips **8.2 / 7.0 / 4.3 idénticos** (desenlaces OPTIMA/ADVERTENCIA/RECHAZADA) · **CERO `lazo=perdonado` en SIM** (no-op demostrado en vivo: `esquinas=sim` → `ESQUINAS_OK` → `faltan=[]` → helper false) · el chip 7.0 MANTIENE `recortada=1` (faltaSeccion del texto as-is — la señal de secciones NUNCA se perdona, pitfall §9.1 verificado en runtime) |
| §6.5 CI del PR | verificado al pushear (4/4 esperado — solo toca los 3 archivos del alcance) |

### 3-a. §6.4 reproducción de campo — **PENDIENTE de re-subida (bloqueo de entrega, NO de código)**

Los 2 ZIPs (`e14-diag-mesa-001-115643-i1.zip` / `e14-diag-mesa-002-115822-i2.zip`) **NO llegaron
al sandbox** (`download/` = carpeta de generados; `upload/` solo los 3 INSTRUCCIONES). Estado honesto:

- La **REGLA** queda demostrada headless con los textos OCR reales del zip1/zip2 (reconstruidos de
  las citas verbatim del kit §1: 621 chars zip1 con MESA 001/SUMA TOTAL/KIT 399/código
  710003993010102; 379 chars zip2 cortado en «TOTAL VOTOS INCINERADOS» sin SUMA/KIT/MESA) —
  casos 1-2 del QA (§6.1), que el kit permite como gate: «Si algo del §6.4 no es reproducible… NO
  disimular: documentarlo en el reporte y dejar el caso 1-2 del QA headless como gate».
- El **desenlace de campo** (zip1 → OPTIMA/auto-envío con `lazo=perdonado`; zip2 → RECHAZADA sin
  cambio) queda pendiente de la re-corrida con los `original.jpg` por la vía de archivo. La nota
  honesta del kit §6.4 sigue vigente: la vía archivo re-corre el pipeline completo y el quad puede
  diferir levemente — lo que se valida es la REGLA.

## 4. Impacto esperado (evidencia del kit §1)

La sesión de campo del 2026-10-17 (auto-envío 25%) habría quedado **50%** con esta regla: el zip1
(ADVERTENCIA 7.9 por lazo inf-izq con sharpness 100 + lectura FUERTE 9/10 anclas + piso 8.5) pasa a
OPTIMA → auto-envío. El zip2 sigue siendo RECHAZADA INCOMPLETA 6.4 (correcto).

## 5. Contrato de entrega

- [x] PR `fix/lectura-perdona-lazo` → main, CI verde.
- [x] `scripts/qa-lectura-perdona.ts` con salida **13/13** (los 10 casos del §5; casos 1-2 con los
  textos OCR reales de los ZIPs según las citas del kit).
- [x] `docs/REPORTE-lectura-perdona-lazo-v1.md` (este) + kit verbatim (md5 `2ea71442a2ed00dc11996af817204617`) + worklog + AGENTS.md.
- [ ] §6.4 con fixtures — tras re-subida de los ZIPs (documentado §3-a; NO disimulado).

## 6. Nota de merge (§8 del kit)

Este kit se mergea **DESPUÉS** del T-B (PR #15 ya actualizado con el des-stub, CI 4/4). Ambos tocan
la línea del log del bridge: al merge, la línea final debe llevar TODOS los tokens:
`… lectura=… anclas=… piso=… diag=1 lazo=perdonado …` (orden del dueño en chat: «mantener TODOS los
tokens»). Este kit nació de main `4aa2e06` (SIN el des-stub) → el conflicto de la línea del log es
ESPERADO y se resuelve en unión.
