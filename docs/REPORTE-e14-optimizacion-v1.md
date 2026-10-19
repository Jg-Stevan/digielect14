# REPORTE-e14-optimizacion-v1 — velocidad + higiene + contador de motivos

**Rama:** `perf/e14-optimizacion-v1` (desde main `22db4eb` = PR #23 mergeado) · **Base:** 5 commits semánticos T1→T5 + docs
**Origen:** `AUDITORIA-e14-v1.md` (hallazgos #1-#6) · **Regla de oro §0:** cero cambios de comportamiento — resultados byte a byte idénticos. Gate/techos/statusDeScore/regla AUTO INTACTOS.

## §0 Precondición
Kit `fuera-informes-v1` YA MERGEADO (PR #23 → `22db4eb`; PR #22 mergeado antes, orden 22→23 del dueño). Anclas A1-A8 re-verificadas: 12/12 exactas; desviación menor A1/A3 (`loadImage` es import del package, no helper local — misma firma; el memo lo envuelve). 13/13 iconos con 0 refs (verificados 1×1).

## §1 Qué se hizo (un commit por tarea, en orden)

| T | Commit | Qué | Riesgo |
|---|--------|-----|--------|
| T1 | `8faf963` | Memo de decodificación `loadImageMemo` FIFO **tope 2** en image-utils + los 6 call-sites (bridge calidad ×2 / esquinas / banda, completitud, rotación). La misma dataURL se decodifica 1× por acta (antes 4-5×). rapidocr SIN tocar (kit §3-T1.5) | cero (mismo decode, RAM acotada) |
| T2 | `2523da7` | `ort.env.wasm.proxy false→true`: det/cls/rec al worker interno de ORT — el main thread queda libre durante el OCR (antes congelado 10-14 s). numThreads intacto (1 en GH Pages — proxy NO requiere SAB) | bajo, revertible 1 línea |
| T3 | `b7893f6` | `git rm` `ort-wasm-simd-threaded.jsep.{wasm,mjs}` (28.3 MB): EP=`["wasm"]` fijo, el loader solo pide el binario no-jsep. Grep seguridad: 0 "jsep" en src/+docs/ | cero runtime |
| T4 | `2c00236` | Higiene: `notaWebgpu` fuera (0 consumidores desde kit 2) + 13 iconos sin uso fuera (icons.tsx 724→547 líneas) | cero |
| T5 | `dcfeff8` | Contador «POR QUÉ NO SE ENVIO — SESIÓN»: `motivosNoEnvio` en memoria + Set anti-duplicado; claves SOLO en `analisisCompletado`; bloque de píldoras `clave ×N` en RESUMEN (D44) | cero (espejo pasivo) |
| T6 | **NO ejecutado** | Experimento det 1920→1280: el kit exige aprobación del dueño EN el PR + validación en SU equipo con los ZIPs de campo. Propuesto abajo | — |

## §2 Verificación (§4 del kit)

- lint 0-0 · `tsc --noEmit` 0 · build estático `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 next build` OK
- `git diff main...perf --name-status` = EXACTO whitelist §1: 7 archivos producción + docs. Zonas prohibidas: 0 diffs (gate/clasificador/ScanView/QuadEditor/worker/CI/package.json/diagnostico.ts)
- **Comportamiento byte-idéntico:** TODAS las capturas de verificación → score 8.2 EXACTO, clasif `AUTO`, cod `710007453010102`, quad igual, lectura FUERTE, anclas 9
- **T2 vivo:** traza `motor=worker`, OCR completo (det 1149-1222 ms, rec 5132-5399 ms, conf 93.3%), 0 errores de página
- **T3 arranque frío:** Network solo pide `ort-wasm-simd-threaded.mjs/.wasm` (200) — 0 requests jsep, 0 404
- **RAM (§4.4):** 5 actas seguidas → heap PLANO 18 MB (memo tope 2 desaloja; sin crecimiento)
- **T5 (:3001):** SIM 8.2 → ENVIADA **no cuenta** · SIM 7.0 → `advertencia:sin-diag ×1` · SIM 4.3 → `rechazo:bajo ×1` · recargar → bloque ausente (sesión fresca, a propósito)

## §3 Medición honesta (misma máquina, dev mode, SIM óptima — logs `[e14-rapidocr]` existentes)

| | total | ocr | det | rec |
|---|---|---|---|---|
| main fría | 8501 ms | 6969 | 1333 | 5215 |
| main caliente | 7712 | 6271 | 1090 | 4869 |
| rama fría | 8544 | 6838 | 1149 | 5257 |
| rama caliente | 8465 | 6974 | 1169 | 5399 |

Lectura sin tintes: en dev-mode con el asset SIM (crop 782×2261) el total es ruido — el OCR domina y T2 no lo acelera, lo DESCENTRALIZA (fluidez); los re-decodes que T1 elimina son baratos con este asset chico. **La ganancia real de T1 escala con las fotos 12 MP del dueño** (decodes de 100-300 ms cada uno, 4-5 por acta) y la de T2 es la UI de ANALIZANDO fluida durante el OCR. Fidelidad: idéntica en ambas ramas.

## §4 T6 — propuesta (pendiente de la firma del dueño)

Commit separado revertible: `OCR_DET_LIMIT=1280` + reemplazo de AMBOS usos de 1920 (op1 reduce_max + op4 det-preprocess). Ganancia esperada det ~0.44×; riesgo: perder cajas pequeñas (mesa/fecha) → menos AUTO. Protocolo del kit: 3 ZIPs de campo en SU equipo + 3 SIM; si los chips se mueven o una real pierde AUTO → se descarta. **No se ejecutó sin aprobación.**

## §5 Cómo probar
`bun run dev` → SIM 8.2 auto-envía igual · SIM 7.0/4.3 → RESUMEN pinta `advertencia:sin-diag ×1` / `rechazo:bajo ×1` · recargar → contadores 0 · ANALIZANDO fluido durante el OCR · `ls -la public/vendor/onnxruntime/` (solo 2 archivos, ~14.3 MB).

## §6 Pendiente
Merge (orden del dueño) · T6 si el dueño aprueba · plan de carga masiva (AUDITORIA §8.4 — el bridge ya es headless-ready).
