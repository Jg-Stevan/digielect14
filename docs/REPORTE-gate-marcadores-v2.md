# REPORTE PARA AUDITORÍA — KIT e14-gate-v2 (marcadores obligatorios + flujo post-recorte normal)

**Rama:** `feat/gate-marcadores-v2` · **Base:** `main` @ `a820b52` · **Fecha:** 2026-10-16
**Estado:** ⏳ ABIERTO PARA AUDITORÍA DEL DUEÑO — **NO MERGEADO** (regla dura del kit).
Ejecutado por Z.ai Code siguiendo `INSTRUCCIONES-e14-gate-v2` (fases G0-G4 + verificación G5).

---

## 1. Resumen del cambio

| Fase | Qué se hizo | Archivos |
|---|---|---|
| G1 | Motor de tinta COMPARTIDO `motorTinta` (extraído de `medirTintaAlFilo`, mismo decode ~320 px, luma<128, <30 ms p95) + módulo `marcadores.ts` (`medirZonaVotos`, zona y 0.45-0.95 × x 0.06-0.94, umbral 0.8 %) | `completitud.ts`, `marcadores.ts` (NUEVO) |
| G2 | Gate FUERA de `evaluarGate` en los DOS puntos simétricos (escaneo + recorte), patrón del veto INCOMPLETA: `SIN_VOTOS` → rechazo directo + cap 6.4 · `types.ts` añade el tipo al union · píldora «ACTA SIN VOTOS» (copy corto, sin guía de cámara) | `scanner-core-bridge.ts`, `types.ts`, `ReviewView.tsx` |
| G3 | Piso de identificación (=10) ELIMINADO: constante, aplicación en `scoreDeCalidad` y re-aplicación en la inyección `simular`. `identificada` sigue alimentando SOLO la clasificación AUTO del gate (intocable) | `scanner-core-bridge.ts` |
| G4 | Flujo post-recorte NORMAL: `aplicarRecorte` auto-envía OPTIMA (mismo camino de `analisisCompletado` D4) · banner «ÓPTIMA · ENVÍO MANUAL» borrado · CTA de envío manual de OPTIMA borrado (y su selector `enviarActa` huérfano) · comentarios D20 normalizados. El recorte SOLO existe en actas NO enviadas (razón de ser de D20 conservada: no hay doble transmisión) | `store.ts`, `ReviewView.tsx` |

## 2. Densidades medidas en las actas de calibración (NADA inventado)

Zona de votos (x 0.06-0.94, y 0.45-0.95), tinta = luma<128 con los pesos del core
(0.299/0.587/0.114). Mediciones con decodificador JPEG puro (jpeg-js) sobre los assets del
repo + verificación EN VIVO del pipeline (los valores del pipeline aparecen en el log
`votos=` de cada captura, campo añadido por este kit).

| Acta | Densidad zona votos | Nota |
|---|---|---|
| `acta-sim-intermedia.jpg` | **15.68 %** | b/n as-is (quad identidad) = medición EXACTA de lo que mide el pipeline. En vivo: **15.8 %** |
| `acta-sim-baja.jpg` | **8.83 %** | borrosa as-is = exacta. En vivo: **10.1 %** |
| `acta-e14-real.jpg` (cruda) | 57.51 % (con fondo oscuro del encuadre); bandas de PAPEL 7.8-17.4 % | proxy — en el pipeline la zona cae sobre el papel warped. En vivo (procesada): **8.8 %** |
| Blanco puro (control) | **0.00 %** | control |
| Margen blanco real del dueño | **0.3 %** | calibración D5 ya existente en `completitud.ts` (filo inferior) |
| **Caso del dueño fabricado** (cabecera real + papel en blanco debajo, fondo oscuro) | **0.0 %** en vivo | reproducido en navegador — ver §4 |
| **Recorte válido en vivo** (acta b/n, quad ajustado) | **18.2 %** en vivo | caso 1 de G4 |

**Umbral elegido: 0.8 %** (kit G1) ≈ 2.6× el peor blanco real medido (0.3 %) y ~11× por
debajo de la acta real más tenue (8.83 %). CALIBRABLE con evidencia (constante
`UMBRAL_VOTOS_PCT` en `marcadores.ts`); la REGLA no cambia.

## 3. Diff del bridge en los 2 puntos (resumen — diff completo en el PR)

**Punto 1 — escaneo** (`pipeline`, tras el guard de completitud y el escudo D10):

```ts
const marcadores = await medirZonaVotos(fotoProcesada);
const marcadoresOk = completa ? marcadores.hayVotos : true;
// ...
const gate: ResultadoGate = !completa
  ? { /* INCOMPLETA — sin cambios */ }
  : !marcadoresOk
    ? { status: intento >= maxIntentos ? EN_REVISION_HUMANA : RECHAZADA,
        rechazo: { tipo: "SIN_VOTOS", detalle: "ACTA SIN VOTOS VISIBLES" },
        clasificacion: null }
    : this.evaluarGate(score, texto, clasificacion, intento, maxIntentos);
if (!completa) score = Math.min(score, 6.4);
if (completa && !marcadoresOk) score = Math.min(score, 6.4);
```

**Punto 2 — recorte** (`pipelineRecorte`, tras `verificarCompletitud`): MISMO criterio
(helper único §4.4), con `acta.intento/acta.maxIntentos`.

Decisiones de implementación (para el veredicto del auditor):

1. **Prioridad:** INCOMPLETA manda primero; el veto de votos SOLO condena actas
   completas sin tinta en la zona de votos (el kit ordena insertar «después del guard
   de completitud»).
2. **Desenlace por intentos:** mismo patrón del veto INCOMPLETA (repetir; al AGOTAR →
   contingencia C4 automática con el MISMO rechazo SIN_VOTOS). Un impreso sin votos no
   puede quedarse en bucle infinito. El kit pide «status RECHAZADA» — se cumple para
   intento < max; la escalación al agotar es el comportamiento existente del patrón
   citado por el propio kit. **Si el dueño prefiere RECHAZADA sin contingencia, es un
   cambio de 2 líneas** (quitar el ternario en ambos puntos).
3. **Sustitución BAJO intacta** (§D3): sin señal de contenido el rechazo final sigue
   siendo BAJO (una foto sin acta no puede decirse «sin votos»). El caso del dueño
   (cabecera legible → señal true) SÍ muestra SIN_VOTOS.
4. **Zona no medible** (decode imposible/recorte <80 px): `hayVotos=false`
   (conservador, §7 de completitud). En la práctica el guard de completitud condena
   antes en esos casos.
5. **Log de auditoría:** ambos pipelines añaden `votos=<pct>%` (y el sufijo
   `SIN_VOTOS` cuando condena) al log `[e14]` — evidencia para calibración.

## 4. Status final de los 3 casos de prueba (FASE G4) — verificados EN NAVEGADOR

Dev server local (Next 16, puerto 3001) + navegador headless (viewport 390×844).
Cero errores de consola en toda la sesión.

| # | Caso | Resultado | Evidencia |
|---|---|---|---|
| 1 | acta en revisión → recorte manual (quad ajustado) → OPTIMA → **se auto-envía sola, sin banner** | ✅ PASS | `[e14] recorte ... completa=true votos=18.2% quad=[0.117,0.056 ...] score=9.4 clasif={...nivel:AUTO}` → pantalla ENVIADA «✓ 9.4/10 ÓPTIMA» + «ENVIADO AUTOMÁTICAMENTE». Score 9.4 = métricas reales (sin piso). Sin banner ni CTA de envío manual |
| 2 | recorte → RECHAZADA SIN_VOTOS → vuelve a captura | ✅ PASS | **Caso del dueño reproducido**: imagen fabricada (cabecera E-14 real + papel en blanco). Pipeline: `completa=true senal=true votos=0.0% SIN_VOTOS score=6.4` (sin gate habría sido ~9.4 OPTIMA → auto-envío = EL BUG). Píldora «ACTA SIN VOTOS» + CTA «OBLIGATORIO REPETIR FOTO». El recorte sobre esa acta re-dispara el gate: `[e14] recorte ... votos=0.0% SIN_VOTOS score=6.4` → RECHAZADA → REPETIR |
| 3 | acta buena directa → OPTIMA → auto-envío (flujo normal intacto) | ✅ PASS | chip óptimo: `votos=8.8% ... score=8.2` → «✓ 8.2/10 ÓPTIMA» → «ENVIADO AUTOMÁTICAMENTE» |

Adicional (no-regresión de la demo SIMULACIÓN — decisión `simular`):

| Chip | En vivo | Resultado |
|---|---|---|
| óptimo | `votos=8.8%` → 8.2 OPTIMA | auto-envío normal (ya no 10.0 — G3) |
| medio | `votos=15.8%` → 7.0 ADVERTENCIA | banda media intacta |
| baja | `votos=10.1%` → 4.3 RECHAZADA «SCORE BAJO» | banda baja intacta (copy sin cambios) |
| recorte con quad identidad sobre acta b/n | `completa=false` (tinta al filo, guard preexistente) | INCOMPLETA manda primero — orden correcto |

## 5. Decisión tomada sobre `simular` (pendiente del dueño №5 del kit)

**El gate SÍ corre en `simular` (default del kit) — la demo NO se rompe.** La duda del
kit era si el gate mataría los chips SIM; medido: los 3 assets pasan la zona de votos
(8.83 %-57.5 % ≫ 0.8 %) y los 3 flujos de la demo quedaron intactos en vivo (tabla de
arriba). No se añadió ningún salto: el gate corre sin excepción en `simular`.

## 6. Verificación obligatoria del kit

| Check | Resultado |
|---|---|
| `rg "PISO_IDENTIFICADA" src` | **0 resultados** ✅ |
| `rg "RECUPERADA\|rescatada" src` | **0 resultados** ✅ |
| `rg "SIN_VOTOS" src` | `types.ts` (union) + `scanner-core-bridge.ts` (2 puntos + detalle) + `ReviewView.tsx` (píldora) + `store.ts` (comentario) ✅ |
| `rg "medirTintaAlFilo\|medirZonaVotos"` | motor compartido `motorTinta` en `completitud.ts` — **sin duplicación** (marcadores.ts solo consume) ✅ |
| `bun run lint` | 0 ✅ |
| `bunx tsc --noEmit` | 0 ✅ |
| `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bunx next build` | ✅ compilado, 3/3 páginas estáticas |
| Worker (`public/scanner/detection-worker.js`) | INTACTO (workflow parity ✓) |
| `@jg-stevan/scanner-core` / clasificador de cabecera | INTACTOS (regla dura) ✅ |

## 7. SHAs

- Base `main`: `a820b52`
- Commits de la rama: ver la sección de commits del PR (feat + docs).
- URL del PR: registrada en `docs/worklog.md` (entrada de esta sesión) y en la
  descripción del PR.

## 8. Observaciones para el dueño (fuera del alcance del kit — NO se tocaron)

1. **Etiqueta del chip óptimo** (`ScanView.tsx` L132: «Simular acta óptima (10.0 — envío
   automático)»): con G3 la banda óptima muestra el score REAL (8.2). El «10.0» del
   label es copy del mock anterior a G3 — requiere decisión del dueño (1 línea).
2. El umbral 0.8 % es CALIBRABLE (`UMBRAL_VOTOS_PCT`); con capturas reales nuevas se
   re-calibra con el campo `votos=` del log, sin tocar reglas.
