# REPORTE — KIT e14-ocr-lee-original-v1 (PROD-1)

**Rama:** `feat/ocr-lee-original` (bifurcada de `feat/informe-telemetria-ocr` @ `8443ff4` — gate §8) · **Base:** PR #10 ABIERTO, SIN merge (regla fija) · **Fecha:** 2026-10-17 (Bogotá) · **Agente:** Z.ai Code

---

## 0. Regla implementada (decisión del dueño)

> TODO el OCR del producto lee el RECORTE SIN filtro (`processImage(fotoOriginal, quad, "original")` — el crudo del warp, warp INTER_CUBIC sin realce). La imagen que se MUESTRA y se GUARDA sigue con el filtro del acta (`bw` en el flujo normal). Nada más cambia.

El motor OCR (Tesseract spa+eng OEM1, downscale 1600, worker caliente del core) queda EXACTAMENTE igual — 0 cambios en `@jg-stevan/scanner-core`.

## 1. Evidencia (del kit §1 — celdas de los informes del dispositivo, motor «actual»)

| Acta | variante | anclas | campos | GT | CER | totalMs |
|---|---|---|---|---|---|---|
| El Cairo P1 | recorte-bw (hoy) | 6/10 | 5 | 9/14 | — | 3989 |
| El Cairo P1 | **recorte-raw** | **8/10** | 5 | **10/14** | — | 4943 |
| Frankfurt P2 | recorte-bw (hoy) | 5/10 | 3 | 7/14 | 54.1 % | 3779 |
| Frankfurt P2 | **recorte-raw** | **7/10** | 4 | **8/14** | 60.6 % | 2299 |

Lectura honesta (goes en las conclusiones del informe): anclas/campos/GT ganan 2/2 actas con raw (eso alimenta clasificarCabecera/consenso/gate); en impresas con sello el crudo COLAPSA chars (260 vs 523 — el texto del editor verá menos en impresas, aceptado por el dueño); NO hay regresión en secciones (Frankfurt P2 ya falla HOY con bw → `faltaSeccionInferior` no empeora); tiempo neutro-ish (el coste real nuevo es el SEGUNDO warp: ~0.6–1.3 s dentro de REALZANDO, cubierto por la misma rampa).

## 2. Qué cambió (3 archivos — diff vs `8443ff4`)

| # | Punto | Archivo | Implementación |
|---|---|---|---|
| C1 | `pipeline()` paso 3+5 | `scanner-core-bridge.ts` | DOS variantes bajo la MISMA `conRampa` (`bw` + `original`) → `fotoOcr` con fallback; paso 5: `requestOcr(fotoOcr)` |
| C2 | `pipelineRecorte()` paso 1+3 | `scanner-core-bridge.ts` | Mismo patrón `{manual:true}`; reuse `pOcr = pBw` si `filtro === "original"` (pitfall §9.4) |
| C3 | `reconocerTexto()` | `scanner-core-bridge.ts` | re-OCR del editor lee recorte "original" si hay `fotoOriginal`+`quadDetectado`; fallback a `fotoProcesada` |
| C4 | Trazas | bridge + `telemetria.ts` | token `ocrIn=` en AMBOS logs de auditoría + `PipelineInfo.ocrInputFiltro` (default `""`) + pasado a `registrarPipelineE14` |
| C5 | Veracidad | `generar.ts` | conclusión «bw (producción hoy)» → «bw (imagen mostrada)» — LÓGICA INTACTA; JSON + TXT del informe traen `ocrInputFiltro` |

Tokens de la traza: `ocrIn=original` (variante cruda OK) · `ocrIn=original-as-is` (SIM as-is) · `ocrIn=bw-fallback` (la variante falló, el OCR leyó la bw — comportamiento de hoy).

## 3. Decisiones / ADAPTACIONES documentadas (ninguna improvisada)

1. **`.catch(() => null)` DENTRO del Promise.all** (kit §4.1, aclaración final): si `processImage("original")` rechaza, `Promise.all` NO rechaza — se decide con el resultado null → `bw-fallback`. El snippet inicial del kit tenía try/catch alrededor de la extracción; la aclaración final del propio kit manda el patrón adoptado. El pipeline JAMÁS muere por la variante nueva (§5, pitfall §9.6).
2. **Token `original-as-is` en SIM** (kit §4.1 decía `ocrIn = "original"` para sinRecorte; la validación §6.3 pide `ocrIn=original-as-is` «o el token que se defina para as-is»; §4.4 enumera los 3 tokens) → se adoptó `original-as-is` para distinguir la entrada as-is de la variante cruda. Implementado.
3. **`pipelineRecorte()` NO invoca `registrarPipelineE14`** en la base `8443ff4` (única llamada en el escaneo, bridge L949; verificado con rg). El campo `ocrInputFiltro` se pasa en la ÚNICA llamada existente. Añadir un registro nuevo en el recorte NO está en el alcance (§2 CAMBIA C1-C5) y ALTERARÍA el contenido del informe (instrumento de medición congelado — NO CAMBIA). El kit §4.4 («lo recibe desde ambos pipelines») describe el estado post-informe asumido; en la base real el recorte no registra — documentado aquí, sin cambio.
4. **El JSON del informe es un mapeo selectivo** (no vuelca `PipelineInfo` completo): el kit §4.4a asumía «el campo nuevo sale solo»; en realidad se añadió EXPLÍCITAMENTE `ocrInputFiltro: pipeline.ocrInputFiltro` al mapeo del JSON (generar.ts L352-355) y a la línea TXT (`filtro=… · ocrInputFiltro=… · motor=…`), y `ocrIn?: string` al cast del TXT. Mismo espíritu del kit, verificado con prueba headless (§4.4).
5. **Tipos de `ocrIn`:** escaneo `"original" | "original-as-is" | "bw-fallback"`; recorte `"original" | "bw-fallback"` (el recorte nunca corre as-is — siempre hay warp manual).

## 4. Validación del agente (§6 del kit) — COMPLETA

| Check | Resultado |
|---|---|
| `bun run lint` | **0 errores** |
| `bunx tsc --noEmit` | **0 errores** (exit 0) |
| `bun run build` | **3/3 páginas estáticas** (compilado en 9.6 s) |
| Intocables §6.2 | **0 archivos fuera de alcance** — diff vs `8443ff4` = SOLO bridge/telemetria/generar; core npm, bun.lock/package.json (0 deps nuevas), divipol.json, ScanView.tsx, store.ts, detection-worker.js, modelos/vendor: **0 toques** |
| SIM óptima (recorte completo) | log `filtro=bw ocrIn=original` · chip `sim=8.2` · `esquinas=sim` · `nivel:AUTO cod:710007483010102 av:PIE_CODIGO_DISCREPAN+KIT_CODIGO_CORREGIDO` · auto-envío OK |
| SIM intermedia (as-is) | log `filtro=original ocrIn=original-as-is` · **`proceso=0` (cero llamadas nuevas — pitfall §9.4)** · chip 7.0 · `nivel:AUTO cod:710003993010102` |
| IMPORTAR (ARCHIVO, 2 variantes) | log `ARCHIVO … proceso=907 filtro=bw ocrIn=original` (misma conRampa 2200) · `esquinas=OK` · `nivel:AUTO` — el acta nace con `filtro=bw`, REVISIÓN muestra bw ✓ |
| RECORTE manual (acta as-is) | log `[e14] recorte … filtro=original ocrIn=original` · **UNA sola llamada** (reuse `pOcr=pBw`, `proceso=478ms` sin duplicar warp — §6.5b) |
| Informe §6.4 | TXT verificado headless: `filtro=bw · ocrInputFiltro=original · motor=worker · ocrChars=100 · registrado=true` · JSON: campo garantizado por tsc (PipelineInfo obligatorio) + mapeo explícito |
| Clasificadores §6.6 | `clasificarCabecera` AUTO en los 3 assets sobre el TEXTO nuevo de la variante original (745/399), `av:` vivos, consenso intacto — **sin regresión; cero ajustes de regex** (pitfall §9) |
| Consola | **0 errores** en toda la sesión (:3001, 412×850) |

No verificable headless: OCR real en gama baja, sello en campo, batería — **QA del dueño (§7 del kit)**.

## 5. Escape hatches y presupuesto (§5 del kit — verificados en código)

- `processImage("original")` falla → OCR lee `fotoProcesada` + `ocrIn=bw-fallback` (el pipeline jamás rechaza por la variante).
- SIM → `fotoOcr = fotoOriginal`, sin llamadas nuevas (chips 8.2/7.0/4.3 intactos por construcción).
- Recorte de acta ya en "original" → UNA sola llamada (promesa compartida).
- Timeout 15 s intacto: el coste añadido es un warp (~0.6–1.3 s) dentro de REALZANDO, cubierto por la rampa 2200 ms.
- `ocrBanda()` intacto sobre `fotoProcesada` (bw — pitfall §9.2).
- Historial viejo: no se reprocesa nada retroactivo.

## 6. QA del dueño (§7 del kit — protocolo)

1. Capturar de nuevo **El Cairo P1** y **Frankfurt P2** (condiciones de los informes base).
2. Esperado (motor actual): anclas 6→8 (Cairo), 5→7 (Frankfurt); campos 5→5 y 3→4; GT 9→10 y 7→8. Menos chars en Frankfurt (≈260) = comportamiento nuevo ESPERADO, no defecto.
3. REVISIÓN/ENVIADA siguen mostrando bw; «Imagen» descarga el JPG bw; el editor sigue ofreciendo filtros.
4. Enviar los 2 informes TXT/JSON — el antes/después se analiza sobre `celdas[actual/recorte-*]` + `ocrInputFiltro` del pipeline.

## 7. Rollback

Revert del PR — sin migraciones, sin datos, sin core, sin deps nuevas.
