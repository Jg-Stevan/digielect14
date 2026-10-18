# REPORTE — KIT e14-esquinas-suaves-v1 (T-Q esquinas flexibles · T-R RESUMEN real del SIM · T-V/T-C limpieza visor)

Fecha: 2026-10-18 · Ejecutado por: Z.ai Code · Rama: `feat/esquinas-suaves` desde main `9fd17e6`
(PR #19 mergeado — kit `e14-luz-sim-puntos-v1` en main; todo lo que este kit dice «como hoy»
es el estado de esa base, verificado línea a línea antes de tocar).

## §0 Mandato del dueño (verbatim, 2026-10-18)

1. «no deberíamos ser tan rígidos con las esquinas» → **T-Q**.
2. «toca que el módulo de "resumen" se actualice con información real (de la simulación)» → **T-R**.
3. «en el visor del editor elimina el cuadro que contiene `· ---` (PIE/CÓDIGO/REGISTRO)» → **T-V**.
4. «también quita la sección COMPORTAMIENTO / EXPORTAR REPORTE» → **T-C**.

Contexto de campo que motivó T-Q: «importo la foto → no la detecta → rechaza → recorto
manualmente → no me guarda el recorte». La auditoría §A-0 del kit concluye que el recorte manual
SÍ se aplica (pipelineRecorte re-warp) pero el gate re-condena por tinta al filo → RECHAZADA 6.4
otra vez → el dueño percibe «no guardó mi recorte». T-Q ataca exactamente ahí.

## §1 Fase C — T-V + T-C (commit `1668704`)

| # | Archivo | Cambio |
|---|---|---|
| 1 | `ReviewView.tsx` | LÍNEA DE ID: fuera `fuenteTxt` y el `<span title="Procedencia del KIT…">`. El chip queda `KIT nnn · TIPO · p/t`. El chip `MESA nnn · POR KIT` SE CONSERVA (no fue pedido). |
| 2 | `ResumenView.tsx` | Fuera la `<section aria-label="Comportamiento del puesto">` completa, el import de `exportarReporteComportamientoZip/reporteComportamiento` y el estado `exportando/exportar`. `diagnostico.ts` SIN CAMBIOS (el acumulador/registrarDesenlace siguen vivos — C4 de REVISIÓN y ZIPs de campo no dependían de esta vista). |

## §2 Fase B — T-R (commit `faf368b`)

**R1 — tick del SIM al shell (`page.tsx`):** mismo `setInterval(avanzarSimulacion, 5000)` con el
mismo guard (`!modoSimulacion || simCompleta` → sin ticks — AC-SIM1). El `useEffect` del tick
QUITADO de `ActasView` (si se dejara, correría DOBLE — duplicado de mount). El pulso
`animate-pulse-sync` del botón SIM se queda (solo visual).

**R2 — RESUMEN deriva del guion vivo (`ResumenView.tsx`):** los números salen de
`store.mesas` (el MISMO que ACTAS): real (`registrarEnvio` marca OK) y SIM
(`avanzarSimulacion` cada 5 s) escriben el MISMO guion → RESUMEN refleja ambos en vivo.

- PROGRESO DEL PUESTO: `SegmentedBar total={totalPaginas} filled={paginasOk}` — texto
  «Has completado N de M páginas del puesto.»
- Tarjetas: `pendientes` → «PÁGINAS PENDIENTES» · `paginasRescaneo` → «PÁGINAS EN RESCANEO»
  (tonos amber/red intactos).
- PUESTO ACTUAL: la ruta suma `· ${mesas.length} MESAS` (solo si `puestoMostrado`).
- ÚLTIMOS ENVÍOS: con SIM ON, filas DERIVADAS del guion (orden de llenado, más reciente
  primero) + label `SIM ${paginasOk}/${totalPaginas}` + subtítulo
  «(SIMULACIÓN — no toca el historial real)». Con SIM OFF, el historial REAL exacto de hoy.
- D6: SOLO lectura. `completadas/asignadasHoy/colaOffline/solicitudesRescaneo` NO se borran del
  store (registrarEnvio y contingencia C4 los usan — quedan como estado interno). Cero edits en
  `avanzarSimulacion`/`alternarModoSimulacion`.

## §3 Fase A — T-Q (commit `d45509b`)

### Q1 — perdón POR LADO con el par fiducial (`completitud.ts`, AMBOS pipelines)

- Helper `ladoConParFiducial(lado, e)`: la marca fiducial es PRUEBA POSITIVA de papel entero
  (ANALISIS §5.1) — si el LADO sospechoso tiene SUS DOS marcas, la tinta al filo de ese lado es
  del IMPRESO (marcas de registro cortadas — calibración D5: la foto perfecta del dueño mide
  7.0/0.3/3.6/0.7%), no del recorte. Mapeo: `N→tl+tr · S→bl+br · O→tl+bl · E→tr+br`.
- `ResultadoCompletitud` gana campo aditivo `perdonLado: string` ("" sin perdón).
- El bucle final de condena perdona el lado con par ANTES de condenar; si TODOS quedan
  perdonados → `tintaFilo=false` → completa (el perdón total 4/4 de FASE 2 queda SUBSUMIDO en la
  rama medida). La rama `!analisis.utilizable` NO cambia (sin medición no hay perdón por lado —
  conservador; `perdonadaSiPapelEntero` sigue viva para ella).
- Token `perdon=` añadido AL FINAL del segmento `esquinas=` en `evidenciaBorde` (escaneo) y
  `evidenciaBordeRecorte` — las líneas `senal=`/`level:` quedan byte a byte.

### Q2 — ESCUDO-MANUAL (`scanner-core-bridge.ts` + `store.ts` + `bridge.ts`)

- `recortar()` gana 6º parámetro `manual = false` → `pipelineRecorte` 7º con default `false`.
- `store.aplicarRecorte` pasa `true` (recorte del editor = decisión CON VISTA).
- En el gate del recorte: `vetoIncompleta = !completa && !manual` · `escudoManual = !completa &&
  manual`. `vetoIncompleta` conserva el RECHAZADO INCOMPLETA (escaneo intacto — conservador en
  campo). `escudoManual` degrada al patrón D10: **techo 7.9** (ADVERTENCIA como máximo, nunca
  ÓPTIMA — el operador decide si repetir). SIN_VOTOS y BAJO siguen mandando (CONTENIDO).
- Marcadores: `vetoIncompleta ? true : (votosSkipPag2 ? true : hayVotos)` — el gate de votos
  SIGUE corriendo con escudo-manual (un rescate sin votos no pasa).
- Orden de caps (pitfall G3): techo fair/poor → sin-señal → piso-10 → escudo-fondo →
  **escudo-manual** → recortada → incompleta → sin-votos. `diag.gate.completa` sigue reportando
  la `completa` REAL (diagnóstico honesto — no maquillar).
- Tokens nuevos en la traza del recorte (final del segmento `esquinas=`): `manual=1` y
  `escudo-manual=1`.
- **DESVIACIÓN JUSTIFICADA (fuera de la lista §A-4 del kit):** `bridge.ts` (contrato
  `E14Bridge` + `CompositeBridge.recortar`) recibe `quadOrigen?`/`manual?` y los REENVÍA. Sin
  ese reenvío, el `manual=true` del store se pierde en la delegación (el composite solo
  reenviaba 4 argumentos) y el escudo jamás llega a `pipelineRecorte` — verificado en vivo: sin
  el cambio no compila (aridad) y con un pasamanos silencioso el flag caería al vacío.
  `mejorarResolución` conserva el default `false` (conservador).

### Q3 — fin de la «ventana de muerte» (`completitud.ts`)

`AREA_MINIMA = 0.3 → 0.25`, alineada con `QUAD_MIN_AREA_RATIO=0.25` del detection-worker. Solo
sospecha/medición — la tinta sigue mandando (25-30% vuelve a ser quad SANO, D4 costo 0).

### Q4 — pie probado por SECCIÓN (`senal-lectura.ts`)

`pieDentro = !faltaSeccion` SIN exigir `/KIT nnn/` — la sección impresa del pie (SUMA TOTAL P1 /
FIRMA P≥2) YA ES la prueba de que el fondo está dentro; exigir además el KIT condenaba actas
cuyo kit solo llega por CÓDIGO/REGISTRO (kitFuente≠PIE). `faltaSeccionInferior` innegociable.
El `topeDentro` de tl/tr NO se toca.

## §4 QA headless (commit `ca9f170`)

| Suite | Resultado | Nota |
|---|---|---|
| `scripts/qa-lectura-perdona.ts` | **13/13** | Caso 7 actualizado al comportamiento Q4 (SUMA TOTAL sin KIT ahora PERDONA — la sección es la prueba; antes false/cap 7.9). |
| `scripts/qa-consenso.ts` | **29 OK · 0 FAIL** | AC5 actualizado a Q1: con 4/4 fiduciales cada lado tiene su par → `tintaFilo=false` y la evidencia migra a `perdonLado="N|S\|E\|O"` (antes el 4/4 conservaba `tintaFilo=true` como evidencia). Misma decisión (completa=true). Los casos conservadores (null → condena; br faltante → condena; quad sano → costo 0) siguen verdes SIN cambios. |
| `scripts/qa-codigo-unico.ts` | **15 OK · 0 FAIL** | Intacto. |
| `bunx tsc --noEmit` | **0 errores** | |
| `bun run lint` | **0 errores** (1 warning preexistente del harness lab/quad-repro.js — documentado desde T-C) | |
| Congelados | `git diff main -- public/scanner/detection-worker.js packages/` = **VACÍO** · `divipol.json`/`diagnostico.ts` sin diff · líneas `senal=`/`level:` byte a byte | |

## §5 Validación en la app real (:3001, navegador)

1. **B2 (SIM OFF)** — RESUMEN: `PROGRESO 33% · 4 de 12 páginas del puesto · 08 PÁGINAS
   PENDIENTES · 01 PÁGINAS EN RESCANEO` + ÚLTIMOS ENVÍOS con el historial real (`ÚLT. ACT.:
   14:32`) y SIN card COMPORTAMIENTO. Captura `lab/resultados/esquinas-suaves-resumen-sim-off.png`.
2. **B1 (SIM ON → RESUMEN vivo)** — 33% (4/12) → 92% (11/12) a los ~12 s → 100% (12/12) con
   «SIM 11/12», filas derivadas (`MESA 02 · DELEGADOS P1 …`) y subtítulo «(SIMULACIÓN — no toca
   el historial real)». **Sonda in-page de cadencia: 4→5→6→7, una página cada 5.0 s exactos —
   tick ÚNICO** (R1 correcto; sin doble tick). Capturas `…resumen-sim-vivo.png` /
   `…resumen-final.png`.
3. **B3 (D6)** — tras una sesión SIM completa: `SIN PUESTO` en RESUMEN, `ACTAS (0)`, historial
   real sin filas SIM al apagar; tras los chips, ACTAS muestra el puesto REAL (Frankfurt · 12
   MESAS DIVIPOL) — cero contaminación.
4. **T-V (visor)** — `KIT --- · --- · -/-` (sin clasificación) y `KIT 745 · TRANSMISIÓN · 1/2`
   / `KIT 399 · TRANSMISIÓN · 1/2` (con clasificación) — SIN el sufijo `· PIE/CÓDIGO/REGISTRO`.
   Captura `…chip-sin-sufijo.png`.
5. **Q2 (escudo-manual, el caso del dueño)** — chip 4.3 → RECORTAR → editor (marco completo,
   T-E) → APLICAR con `defaultQuad`: traza
   `[e14] recorte SIMULACION … completa=true … manual=1 … score=4.9` (quad sano → completa →
   pasa al gate; BAJO de contenido manda — el asset demo no tiene anclas).
   **Escudo forzado**: vértice arrastrado al filo exacto (`quad=[0.000,0.000 …]`) → traza
   `[e14] recorte … completa=false … borde=N|O tintaFilo=true franja=[7.1,82.6] fondo=false
   **manual=1 escudo-manual=1** … score=4.9 …` → `!completa` con manual NO produjo
   RECHAZADA-INCOMPLETA (sin token `incompleta:6.4`): pasa al gate con techo 7.9 y el desenlace
   lo decide el CONTENIDO (BAJO 4.9 por `sin-senal` del asset demo — con una foto real con
   lectura el techo activo sería 7.9 = ADVERTENCIA).
6. **A3 (regresión chips SIM)** — 8.2 → `✓ 8.2/10 ÓPTIMA · ENVIADO AUTOMÁTICAMENTE` ·
   7.0 → `score=7` exacto (ADVERTENCIA) · 4.3 → RECHAZADA. Esquinas/verificación no corren en
   SIM (guard intacto — Q1-Q4 no tocan esa rama).

**Nota honesta (observación preexistente):** el flujo «recorte manual sobre acta SIMULACION»
imprime `[e14-informe] error: … toUpperCase of undefined` — reproducido IDÉNTICO en main
`9fd17e6` (A/B con worktree en :3002, 2 apariciones en el mismo flujo). Módulo de observación
pasiva (try/catch, el desenlace no se toca). NO es regresión de este kit; queda documentado
para el kit de informe que corresponda.

## §6 Límites (lo que el kit NO hace — §RIESGOS)

- No toca el core ni el worker (detención Sobel-strip intacta — T-Q la vuelve INOCUA para el
  flujo: RECHAZADA → rescate manual que ahora SÍ pasa).
- El veto INCOMPLETA en el ESCANEO sigue vivo (solo se perdona con evidencia positiva — par
  fiducial por lado); la tinta al filo sigue condenando escaneos con sospecha sin fiduciales
  (QA AC5 conservador verde).
- No auto-envía rescates con sospecha: escudo-manual techo 7.9 = ADVERTENCIA consciente.
  Cero cambios al gate de votos y a BAJO.
- Nada del SIM escribe datos reales (D6 re-verificado en B3).

## §7 Pendiente del dueño

1. Push de `feat/esquinas-suaves` + PR (el sandbox de esta sesión no tiene credenciales):
   `git push -u origin feat/esquinas-suaves` → 1 PR con las 3 fases (commits atómicos
   `1668704` C · `faf368b` B · `d45509b` A · `ca9f170` QA · docs).
2. QA física §A-ACEPTACIÓN con SU foto difícil (la que motiva el kit): importar → RECHAZADA →
   RECORTAR → asas al papel → APLICAR → ADVERTENCIA como máximo + traza
   `manual=1 escudo-manual=1` (+ `perdon=` cuando las fiduciales de SU impresión se lean).
