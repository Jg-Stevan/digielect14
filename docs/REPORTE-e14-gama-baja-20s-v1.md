# REPORTE — KIT e14-gama-baja-20s-v1

**Fecha:** 2026-10-29 · **Rama:** `feat/e14-gama-baja-20s-v1` · **Base:** main `65dedc61`
**Petición del dueño:** «ayudame a que el procesamiento de la imagen sea en 20 segundos, todo en
el dispositivo del usuario offline sin VLM» · contexto: la única medición con perfil «gama baja»
dio **pipeline 125 809 ms** (CPU 6×, 4 núcleos, **mono-hilo** — sin COOP/COEP, escenario
GH Pages; `docs/evidence/sim-recursos/sim-lowend-resultados.json`) y la lectura del repo es
«el coste es TIEMPO de OCR mono-hilo».

## 0 · Diagnóstico (dónde se va el tiempo)

1. **El OCR es el dominante** (~68% del total — `ocr-escalonado.ts:4-5`) y en el baseline
   mono-hilo se multiplica.
2. **El re-OCR 1920 completo es el multiplicador silencioso**: cuando la 1.ª pasada (det 1280)
   no sale FUERTE (`necesitaSegunda`), se re-corre det+cls+rec de TODO el acta a 1920
   (`reconocerRapidOcrEscalonado`) — ~2.5× el coste de la 1.ª pasada. En fotos flojas de gama
   baja salta casi siempre.
3. **Costes ocultos ya mitigados** (palancas activas — NO se tocan): det 1280 (D53, −56%),
   REC_WMAX 480 (−17-26% rec), prewarm (D50, mata ~27 s fríos), det-memo (D62),
   mini-probe 320 + brújula QR (D62/WAVE2).
4. **Multihilo**: el baseline corrió SIN COOP/COEP. Con Cloudflare Pages (D73, ya en
   producción) el plan adaptativo activo da BAJO=2 hilos — ahorro esperado OCR ÷~1.8-2.2
   SIN código nuevo. Este kit NO depende de ello pero lo complementa.

## 1 · Diseño — knobs de PERFORMANCE por tier (jamás reglas de negocio)

Heredero directo del patrón del kit e14-adaptacion-dispositivo-v1: el tier deja de solo-fijar
`ocrHilos` y ahora consume TRES knobs OCR nuevos, resueltos SYNC en `adaptacion/plan.ts`:

| Knob | BAJO | MEDIO/ALTO · histórico | Qué controla |
|---|---|---|---|
| `ocrReOcrModo` | `"roi-cabecera"` | `"completo"` | El 2.º intento cuando la 1.ª pasada sale débil: rescate de la franja superior 0-25% re-escalada a cap 1920 (MISMO helper y fracciones de la cascada K3: `recortarRoiDataUrl` + `ROI_FRACCIONES.top`) en vez del re-OCR 1920 COMPLETO. En gama baja el completo cuesta ~2.5× la 1.ª pasada (det ≈ (1920/1280)² + cls + rec de todo). |
| `ocrSegundaPresupuestoMs` | `15000` | `null` (sin tope adicional) | Tope PARED del pipeline para PERMITIR abrir el intento extra. Nunca se abandona una pasada a mitad: solo se decide NO ABRIR una nueva (§3 del kit escalonado — el timeout EXISTENTE sigue mandando). |
| `probeBudgetMs` | `6000` | `12000` (default) | Presupuesto del sondeo de orientación (fail-fast en BAJO: si la miniatura no alcanzó confianza, el sondeo completo rara vez converge en gama baja — det 3037 ms medido en HP 4-core, D56 §3 T3). |

**Doctrina del rescate (regla nueva, pura y testeable — `rescateAporta` en ocr-escalonado.ts):**
el candidato compuesto (cabecera del ROI + cuerpo de la 1.ª pasada) CONTIENE SIEMPRE al texto
base ⇒ las anclas (`re.test` → booleano por ancla; duplicados NO inflan) solo pueden aumentar o
empatar. El rescate se adopta SOLO si leyó AL MENOS UNA ancla nueva: **información puramente
aditiva — JAMÁS intercambia texto sin ganancia** (más conservador que `elegirMejor` para un
candidato que NO es una pasada independiente: su conf no es comparable). JAMÁS tumba: cualquier
fallo del crop/OCR → la 1.ª pasada queda como está.

## 2 · Kill-switch y trazabilidad

- **Cero flags nuevos.** El kill-switch EXISTENTE `adaptacionDispositivo: false`
  (localStorage `e14-flags-overrides` o PanelDev §6) revierte TODOS los knobs al histórico
  byte a byte (`KNOBS_OCR_HISTORICO`). El override manual `ocrThreadsTope` (D6) sigue mandando
  sobre `ocrHilos`; los knobs nuevos no tienen override propio (solo el kill-switch).
- SIM intacto: el camino `simular` sale ANTES de cualquier decisión (chips 8.2/7.0/4.3 intactos).
- MEDIO/ALTO: byte-idéntico a hoy (modo completo + sin tope adicional + probe 12000).
- **Trazas**: línea EXISTENTE `[e14] ocr-escalonado …` intacta (parsers seguros); el rescate
  añade línea PROPIA NUEVA `[e14] ocr-rescate-cabecera y0=0 y1=0.25 ms=… anclas1=… anclas2=… adoptado=…`.
- **Informe IA** (`adaptacion/informe-ia.ts`): `plan_aplicado` gana 3 campos aditivos
  (`ocr_reocr_modo`, `ocr_segunda_presupuesto_ms`, `probe_budget_ms`) + explicación extendida.

## 3 · Consumo real

| Archivo | Cambio |
|---|---|
| `adaptacion/plan.ts` | `KNOBS_OCR_POR_TIER` + `KNOBS_OCR_HISTORICO`; `PlanAdaptativo` +3 campos; 4 return-sites resuelven knobs (OFF/override/plan/catch). |
| `ocr-escalonado.ts` | + `rescateAporta(textoBase, textoRescate)` — puro, headless. |
| `scanner-core-bridge.ts` | `reconocerRapidOcrEscalonado`: presupuesto de la 2.ª por plan + rama `roi-cabecera` (usa `recortarRoiDataUrl` + `rapidOcrReconocer` + `rescateAporta`) con traza propia; 2 call-sites de `probeOrientacion` pasan `presupuestoMs` del plan. |
| `orientacion.ts` | `OpcionesProbeOrientacion.presupuestoMs?: number` (sin pasar = 12000, byte-idéntico). |
| `adaptacion/informe-ia.ts` | `plan_aplicado` +3 campos aditivos + explicación. |

LO QUE NO SE TOCA (reglas de negocio — D6): DET_CAP (1280/1920), REC_WMAX (480), FOTO_LADDER,
constraints de cámara, scores, gates, umbrales, desenlaces, `necesitaSegunda`, `elegirMejor`,
el flujo de la cascada K3 (sigue flag OFF), el prewarm, la banda condicional.

## 4 · Expectativa cuantificada (honesta)

| Perfil | Hoy | Con kit (+CF Pages multihilo) |
|---|---|---|
| Normal | 14.1 s ✅ | ~12-13 s (sin cambio de comportamiento) |
| Gama baja REAL (~3.5× vs desktop, 4 núcleos, 2 hilos wasm — p. ej. SM-A135M en CF Pages) | ~45-55 s est. | **~15-22 s** |
| Sim 6× mono-hilo (GH Pages, peor caso absoluto ≈ un teléfono ~2016) | 125.8 s | ~55-70 s |

El tope duro queda matemáticamente acotado en BAJO: pass-1 (no interrumpible) + rescate solo
si el presupuesto de 15 s lo permite + probe fail-fast. Actas FUERTE a la 1.ª no pagan NADA
extra (camino idéntico al escalonado actual).

## 5 · Verificación (gates)

- `bunx tsc --noEmit` → **0 errores**.
- `bun run lint` → **0 problemas / 0 warnings**.
- `bun run test` → vitest **233/233** (16 archivos — idéntico al baseline, 0 regresiones).
- Validación de comportamiento pendiente del dueño (ver §6).

## 6 · Pendientes (dueño)

1. **Validación de campo en gama baja real** (SM-A135M u otro): medir con el rastreo del
   PanelDev §9 (kit e14-rastreo-tiempos-v1) + informe IA (§8) en CF Pages (multihilo) y
   comparar contra la expectativa de §4.
2. **Bench del rescate ROI-cabecera en BAJO** (criterio de aceptación sugerido): en actas
   flojas del lote real, veredicto final idéntico al escalonado de hoy en ≥95% y rescate que
   recupere MESA/código cuando aporta. Traza `[e14] ocr-rescate-cabecera` lista para minar.
3. **Bench `tools/bench-recW400`** (sub-palanca NO activada aquí): REC_WMAX 480→400 en BAJO
   rec ÷~1.2 — requiere ≥99% texto idéntico, Δconf ≤0.5, ≥1.15× (mismo protocolo del
   bench-rec-int8). Solo con GO se suma al plan como 4.º knob.
4. cls lote 12 (GO del banco B2 para cls: 1.25-1.30×) — decisión global del dueño pendiente
   (el kit NO la activa).
5. WebGPU EP (banco B4 bloqueado en headless) — opt-in futuro solo con bench en hardware real.
