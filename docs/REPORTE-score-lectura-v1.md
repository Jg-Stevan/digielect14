# REPORTE — KIT e14-score-lectura-v1 (SCORE v2: "LA LECTURA MANDA")

**Rama:** `feat/score-lectura` (desde `origin/main` @ `5feea02` — §8) · **Fecha:** 2026-10-17 (Bogotá) · **Agente:** Z.ai Code · **PR:** ABIERTO, SIN merge (espera auditoría)

---

## 0. Alcance implementado (§2 — A+B+C completos)

| # | Propuesta | Dónde | Resultado |
|---|---|---|---|
| A | Nitidez de alta resolución | `scanner-core-bridge.ts` | `sharpnessHi` = min(100, mediana de σ(Laplaciano) de 9 tiles 3×3 × 2.2) sobre el recorte derivado a **1000px** (solo downscale, 1 getImageData) |
| B | Contraste de papel | `scanner-core-bridge.ts` | `contrastPapel` = min(100, (p95−p5 del histograma 256 bins, percentiles por barrido acumulado SIN sort) × 100/160); `contrasteEfectivoDe` → `max(q.contrast, q.contrastPapel, ocrLegible ? 80 : 0)` — **el piso §X QUEDA** (pitfall §9.6) |
| C | Ajuste por lectura | `senal-lectura.ts` (NUEVO, puro) + 2 sitios de llamada | FUERTE (mesa+4 anclas o ≥6) y level≠poor → **piso 8.5** · DEBIL → **techo 5.9** · MEDIA no toca. Insertado EXACTAMENTE entre `scoreDeCalidad` y la inyección SIM / caps posteriores (§4-B3) |
| — | Trazas | 2 logs de auditoría | `lectura=<NIVEL> anclas=<k> piso=<bool>` en escaneo y recorte |

**FUERA de alcance por orden del dueño (§0):** el score de disparo en vivo (0→100% del chip): `quality.js` del core, frame loop de ScanView, `SHUTTER_SCORE` — 0 toques. `packages/` — 0 toques. Solo cambia el score POST-captura.

## 1. Módulo `senal-lectura.ts` (§4-A)

- 10 `ANCLAS_LECTURA` regex estructurales EXACTAS del kit. **Copia local documentada**: la fuente (`informe/analisis-texto.ts`) vive en el PR #10 NO mergeado (§4-A: "si NO, copia local documentada"). Diferencia honesta con el instrumento: aquí «TRANSMISIÓN» → «KIT nnn» (definición del kit). `norm()` replicada **byte a byte** del informe (upper→NFD sin diacríticos→[^A-Z0-9]+→" "→trim — pitfall §9.10: si el informe se mergea primero, los números cuadran).
- Constantes con rationale (§3): `PISO_LECTURA_FUERTE=8.5` · `TECHO_LECTURA_DEBIL=5.9` (exportadas desde el módulo) · `HI_RES_LADO=1000` · `LAP_NORM=2.2` · `PAPER_SPREAD_NORM=160` (en el bridge, junto al helper).
- `PageQualityV2 extends PageQuality` (tipo LOCAL — pitfall §9.7: el core y su import intocables).

## 2. Verificación §6 del kit — COMPLETA

| Check | Resultado |
|---|---|
| 1. `bun run lint` | **0** (y `tsc --noEmit` 0 — bonus; `bun run build` NO corrido: prohibido §8) |
| 2. Smoke módulo puro (bun -e) | **4/4**: `ZONA:15 PUESTO:02 MESA:012 KIT 745 710007453010202` → **FUERTE** (5 anclas, mesa+4) · `""` → **DEBIL** · `"hola mundo"` → **DEBIL** · `"E-14 REGISTRADURIA"` → **MEDIA** (2 anclas) |
| 3. Chips SIM (no-regresión dura) | **8.2 / 7.0 / 4.3 idénticos** — `sim=8.2 score=8.2` · `sim=7 score=7` · `sim=4.3 score=4.3`; estados OPTIMA/ADVERTENCIA/RECHAZADA intactos; 0 errores de consola (:3001, 412×850) |
| 4. Foto real importada | **Frankfurt P1** (`src/assets/acta-e14-real.jpg` — la ÚNICA foto real en el repo): `score=8.9 lectura=FUERTE anclas=6 piso=true esquinas=OK nivel:AUTO` — §6.4 CUMPLIDO en el caso disponible. **⚠️ Las 4 fotos de `public/fotos-lab/` NO EXISTEN en el repo** (se perdieron con el sandbox — situación conocida/documentada desde el track FILTROS-1): las capturas restantes (2× Frankfurt P2, El Cairo P1) quedan para el QA del dueño (§7) con SUS capturas de campo |
| 5. Costo | **Sin llamada OCR nueva** (la señal consume el texto POST-banda ya leído) · **CALIDAD <200 ms en TODAS las corridas**: 75 / 39 / 100 / 111 / 101 ms |
| — | Recorte manual (pitfall §9.9): `[e14] recorte … score=4.9 lectura=DEBIL anclas=0 piso=false` — techo DEBIL no empeora (4.9≤5.9) y los caps posteriores ganan (escudo fondo `fondo=true` + `recortada=1` → 4.9≤7.9) |

## 3. Tabla antes/después (descomposición verificable con los logs)

| Caso | Antes (v1) | Después (v2) | Δ y causa |
|---|---|---|---|
| Frankfurt P1 real (importada) | 8.5 — bruto v1 = (sharp 100×.4 + bright 62×.3 + contEf 87×.3)/10 (contEf = max(87,80)=87) | **8.9** (`piso=true`, `lectura=FUERTE anclas=6`) | **+0.4** — `contrastPapel` rescata el spread de tinta: contEf = max(87, **100**, 80) = 100; el piso FUERTE además GARANTIZA ≥8.5 (OPTIMA) aunque la visión baje |
| SIM óptima | chip 8.2 | chip **8.2** (inyección manda — C3 corre ANTES) | 0 — no-regresión AC-S2 |
| SIM intermedia | chip 7.0 | chip **7.0** | 0 |
| SIM baja | chip 4.3 | chip **4.3** | 0 |
| Acta baja (borrosa as-is, sin anclas) | 4.9 (sin señal 4.9) | **4.9** (`lectura=DEBIL` → techo 5.9 NO empeora) | 0 — comportamiento §5 "bolsa de papas": 4.9 + DEBIL ≤5.9 |
| Recorte manual de la baja | 4.9 | **4.9** (mismo criterio C3 en re-análisis — §9.9) | 0 |

Techos de los casos: escudo fondo/recortada aplican DESPUÉS del ajuste y siguen MANDANDO (pitfall §9.4 verificado en el recorte: `fondo=true recortada=1 → 4.9`).

## 4. Decisiones / ADAPTACIONES documentadas

1. **`vars.sort()` de 9 valores** — el pitfall §9.2 prohíbe sort de ~10⁶ PÍXELES (percentiles por histograma, respetado); la mediana de las 9 varianzas de tiles se ordena trivialmente (9 elementos).
2. **Level recalculado cuando cambia CUALQUIERA de las 2 entradas v2** (`sharpnessV2 !== q.sharpness || contrasteEf !== q.contrast`) — la condición v1 solo miraba el contraste; §3 paso 2 del kit manda recalcular el level con sharpnessV2/contrasteEfectivo (misma fórmula/umbrales 80/62/45 duplicados byte a byte).
3. **§6.4 con la única foto real disponible** — `public/fotos-lab/` no existe (fotos perdidas con el sandbox, documentado desde FILTROS-1); Frankfurt P1 real demuestra el camino completo (piso activo). Resto → QA del dueño §7.
4. **Base `origin/main` `5feea02` según §8** — el kit CONTEMPLA el conflicto futuro con PROD-1/PROD-2 en la zona OCR→score (L775-826/L1160-1186): la resolución será "mantener AMBOS cambios" (el filtro/motor del OCR de PROD-1/2 + el ajuste C3). Este PR NO mergea nada.

## 5. QA del dueño (§7 del kit — después del merge)

1. Acta real en buena luz → ≥8.5 con banner ÓPTIMA.
2. Sombra/reflejo parcial → la MEDIANA de tiles no se deja engañar por UN reflejo (comparar con el score de hoy).
3. Borroso a propósito → ≤6.4 (techo poor) aunque el OCR lea algo.
4. Chips MEDIO y BAJA de SIM → 7.0 y 4.3 idénticos.
5. Enviar los X/10 + logs (`lectura=… anclas=… piso=…`) para la recalibración fina (PAPER_SPREAD_NORM / umbrales de FUERTE).

## 6. Rollback

Revert del PR — módulo nuevo + 1 archivo tocado (`scanner-core-bridge.ts`); sin core, sin deps, sin migraciones.
