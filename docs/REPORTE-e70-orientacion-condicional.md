# REPORTE — e70-orientacion-condicional-v1

**Kit:** P4.1 — fix del skip de orientación (falso positivo de EXIF). El guard e66 (P4) omitía el `orientacionProbe` completo cuando `origenSenales === "exif-camara"`; el EXIF solo dice cómo estaba el TELÉFONO, no cómo quedó el acta. Evidencia del dueño: 3 fotos reales landscape (texto de lado) CON EXIF → rechazadas score 4.9, anclas 0, `cabeceraE14: false` — el OCR leyó basura sin que nadie intentara corregir la rotación.
**Base:** `main @ 9083f66` (e69 mergeado, PR #85) — EXACTA contra el remoto.
**Rama:** `feat/e70-orientacion-condicional-v1`.
**Gates finales:** tsc 0 · lint 0 · **7/7 suites SIN adendas**: historico-enviadas 49/49 · dedup-enviadas 42/42 · qr-identidad 68/68 · autoenvío 33/33 · escaneo-ya-recortado 24/24 · identidad-acta 32/32 · watchdog-relectura 34/34. `package.json`/`bun.lock` INTACTOS.

---

## 1. Resumen ejecutivo

El skip por EXIF pasa de **incondicional** a **condicional**:

1. **El sondeo ya no se omite por el EXIF solo** — el branch `exif-camara` del bridge entra en MODO CONFIRMACIÓN: el probe corre SIEMPRE, pero su pasada 0° (det cap rápido + rec sobre los 8 crops) puede confirmar la orientación y cerrar sin challengers.
2. **Criterio de skip (literal del dueño):** `quadOrigen === "worker"` (NO el fallback sobel) **Y** `anclas0 >= 3` **Y** `conf0 >= 0.7` a 0° → `cortes=confirmada` → aplicado=0, sin rotación, sin sondear 90/180/270.
3. **Cualquier condición fallida** (anclas 0, conf 0.3, quad de fallback) → sondeo completo 0/90/180/270 (el 0° baseline ya está pagado y se REUSA — no hay trabajo duplicado) y el MARGEN (1.5) decide la rotación ANTES del OCR principal.
4. **En modo confirmación el atajo T1 `sana` NO aplica** — su MEDIA incluye `chars >= 150` (150+ chars de basura leídos de un acta de lado contaban como lectura válida): el criterio del dueño es EL gate. Sin opciones (recorte manual, flujos sin EXIF) → T1 intacto byte a byte.
5. **Traza:** `cortes=confirmada` (valor ADITIVO — D51) + `exif=0|1` (ADITIVO AL FINAL): 1 = el caller pidió modo confirmación.

## 2. Recon (M-e70-0 — nombres reales vs plan)

| El plan decía | La realidad en el repo | Consecuencia |
| --- | --- | --- |
| Skip en `scanner-core-bridge.ts` «o donde esté» | EXACTO: guard L1397 (`if (opciones.origenSenales === "exif-camara")` → `console.info("omitida=exif-camara")`) | Ubicación correcta — el guard se reescribe, no se mueve |
| «El det inicial (la primera pasada de OCR rápido)» | NO existe NINGUNA pasada de OCR previa al probe en el pipeline (quad → warp → **probe** → OCR escalonado 1280/1920). Los valores que cita el dueño («anclas: 0, conf: 0.3») son exactamente `anclas0/conf0` — el **baseline 0° del propio probe** | La pasada 0° del probe ES el det inicial del criterio: det cap rápido (1280) + rec sobre 8 crops. El skip se decide con ELLA — cero pasadas nuevas |
| `quadOrigen` «worker» vs fallback | `OrigenQuad = "worker" \| "sobel"` (+ `"pagina-completa"`/null en escaneos/SIM) — calculado ANTES del probe en la MISMA función (L1262) | Señal disponible sin costo: `confirmar: { quadWorker: quadOrigen === "worker" }` |
| Las 5 sanas «no pagan el costo del probe» | La señal `anclas/conf` SOLO la produce `rec` (el det encuentra cajas, no lee texto) → confirmar exige det+rec0 (~4-6 s en HP 4 cores) | **M-e70-1:** las sanas pagan det+rec0 pero NO las challengers (3-9 s) — el ahorro de P4 se reduce, no desaparece; las rotadas dejan de ser RECHAZADA (re-shoot + revisión del operador costaba mucho más que 12 s) |
| Probe «probar 0, 90, 180, 270» | El probe ya sondea 0° SIEMPRE (baseline del MARGEN) + orden adaptativo D62 (ganador persistente primero) | El 0° del criterio ya existe — el fix es un atajo nuevo, no un flujo nuevo |

**Segundo caller verificado:** `pipelineRecorte` (recorte manual, L2097) llama `probeOrientacion` SIN opciones → byte a byte (el usuario ya corrigió el encuadre manualmente; sin señal `origenSenales` en esa ruta).

## 3. Implementación

### 3.1 `orientacion.ts` — modo confirmación

- `OpcionesProbeOrientacion { confirmar?: { quadWorker: boolean } }` — su PRESENCIA activa el modo (solo el branch exif-camara del bridge lo pasa).
- En la pasada 0°: `quadWorker && anclas0 >= 3 && conf0 >= 0.7` → `corte = "confirmada"`; break (aplicado=0 — la rotación ganadora queda 0). Si el modo está activo pero el criterio falla → `continue` (sondea challengers; el 0° ya computado alimenta el MARGEN).
- En modo confirmación T1 `sana` NO aplica (rama exclusiva). Sin `confirmar` → rama original intacta (recorte manual, flujos sin EXIF).
- Traza principal: `exif=${opciones?.confirmar ? 1 : 0}` ADITIVO AL FINAL (después de `gan=`). La línea de det vacío (`cortes=vacio`) queda byte a byte (mismo desenlace en ambos modos: aplicado=0 — sin cajas no hay rotación posible).
- Anillo D62 intacto: solo desenlaces aplicado=1 escriben; `confirmada` nunca rota → nunca escribe.

### 3.2 `scanner-core-bridge.ts` — guard condicional

- `if (!opciones.simular && opciones.origenSenales === "exif-camara")` → `probeOrientacion(fotoOcr, { confirmar: { quadWorker: quadOrigen === "worker" } })` + rotación si `aplicado` (fotoOcr Y fotoProcesada — igual que siempre).
- SIM jamás sondea (la condición `!opciones.simular` gobierna ambas ramas — §2.2 intacto).
- La línea de log `orientacion omitida=exif-camara` DESAPARECE — la traza del probe es ahora la única fuente de verdad (una línea, una verdad). Ningún QA la escaneaba (verificado).
- `probeMsOrientacion` vuelve a ser real para exif-camara (antes null forzado): `diag.orientacionProbeMs` muestra el costo honesto (det+rec0 o el sondeo completo).

### 3.3 Sin cambios

- `informe.ts`/tipos — cero cambios de contrato (el ms ya existía; los campos de traza son aditivos).
- `origen.ts` (clasificación `exif-camara`), runner, masiva/cola, jornada (e69), P6 (watchdog/rescate) — byte a byte.
- Flujos individual/video: sin `origenSenales` → rama de siempre → byte a byte.

## 4. Comportamiento esperado (del dueño)

| Caso | Antes (e66) | Ahora (e70) |
| --- | --- | --- |
| 3 fotos landscape con EXIF | Probe OMITIDO → OCR basura → RECHAZADA 4.9 (anclas 0) | 0° lee basura (anclas 0, conf bajo) → criterio falla → sondea 90/270/180 → anclas en 90°/270° → rotación aplicada (aplicado=1) → OCR principal lee de verdad → **ENVIADA o ADVERTENCIA con score alto** |
| 5 fotos sanas con EXIF | Probe OMITIDO (0 s de sondeo) | 0° lee anclas ≥ 3 + conf ≥ 0.7 + quad worker → `cortes=confirmada` → **sin challengers** (pagan det+rec0, M-e70-1) → igual de ENVIADAS |
| Sana con quad sobel | Probe OMITIDO | quadWorker=false → criterio falla por geometría → sondeo completo → el MARGEN no rota (0° lee bien) → aplicado=0 (paga el sondeo — defensivo, el warp de sobel es sospechoso) |
| Rotada + budget agotado | n/a (no sondeaba) | `cortes=presupuesto` → sigue con 0° (comportamiento de hoy — el catch/presupuesto jamás tumba el pipeline) |

## 5. Cómo probar (procedimiento del dueño)

1. **Las 3 rotadas:** re-encolar las 3 fotos del lote → consola: `[e14] orientacion ... probe={0:0.41,90:8.xx} anclas90=6 conf90=0.8x aplicado=1 ... exif=1` → actas ENVIADA/ADVERTENCIA con score alto.
2. **Las 5 sanas:** `[e14] orientacion ... probe={0:6.02} anclas0=4 conf0=0.85 aplicado=0 ms=~4000 cortes=confirmada ... exif=1` → sin sondas 90/270/180, desenlace de siempre.
3. **Costo:** `diag.orientacionProbeMs` en la ficha del informe vuelve a tener valor real para exif-camara (antes null).
4. **Regresión:** lote normal sin EXIF (escaneos/SIM) → trazas con `exif=0` y `cortes=sana/completo` como siempre; recorte manual → sondeo completo de siempre.

## 6. Desviaciones (M-e70-*)

- **M-e70-0 — el «det inicial» ES el baseline 0° del probe:** no hay pasada de OCR previa al probe en el pipeline; los valores del criterio del dueño (anclas/conf) solo los produce el rec de la pasada 0° (el det encuentra cajas, no lee). El skip se decide con la señal que ya existía — cero pasadas nuevas, cero trabajo duplicado si el criterio falla (el 0° se reusa para el MARGEN).
- **M-e70-1 — costo honesto de las sanas:** «sin pagar el costo del probe» se materializa como «sin pagar las challengers»: confirmar exige det+rec0 (~4-6 s en HP 4 cores — la señal no existe antes de rec). El ahorro neto de P4 se reduce; el intercambio lo diseñó el dueño (las rotadas RECHAZADAS costaban re-shoot + revisión).
- **M-e70-2 — T1 `sana` deshabilitado en modo confirmación:** la MEDIA de `senalDeLectura` incluye `chars >= 150` — un acta de lado con 150+ chars de basura a 0° habría salido por el atajo sin sondear (el mismo falso positivo del EXIF). El criterio del dueño (anclas ≥ 3 REALES + conf ≥ 0.7) es EL gate en exif; T1 queda intacto para todos los demás flujos.
- **M-e70-3 — quad de escaneo/SIM:** `pagina-completa`/null ⇒ `quadWorker=false` ⇒ sondeo completo. Hoy inalcanzable (los escaneos traen `sin-exif` en sus señales y SIM nunca pasa `origenSenales`) — defensa en profundidad.
- **M-e70-4 — recorte manual intacto:** `pipelineRecorte` llama el probe sin opciones (T1 sana vigente) — el usuario ya intervino manualmente y esa ruta no tiene señal de origen.
- **M-e70-5 — umbral literal ≥ 3:** el criterio del plan dice «anclas >= 3» (y «> 3» en el resultado esperado) — se implementó el literal del criterio (≥ 3).
- **M-e70-6 — traza:** `cortes=confirmada` (nuevo valor aditivo de un campo existente) + `exif=0|1` (ADITIVO AL FINAL — D51). La línea `cortes=vacio` y el resto de campos previos NO cambian de forma. La línea del bridge `orientacion omitida=exif-camara` desaparece (ningún QA la escaneaba — verificado en scripts/).

## 7. Fuera de alcance (follow-ups)

- Confirmación con menos crops (p. ej. 4 de 8) para abaratar det+rec0 de las sanas — rompería la coherencia del MARGEN (baseline vs challengers con k distinto); requiere kit propio.
- Cls específico 90/270 de página (PP-OCR solo corrige 180° de línea) — el probe de sondeos ya lo cubre.
- P8 (serie no detectada) — sigue en observación, no tocado.
