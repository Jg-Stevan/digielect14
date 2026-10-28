# REPORTE — KIT flujo-dueno-v1 (K2) — warp de ingesta + sondeo sobre warp + cuadrante→rotación (pasos 2+3+5)

- **Agente:** B (brief `BRIEFS-flujo-dueno-3-agentes.md`) — Z.ai Code
- **Rama:** `feat/k2-warp-ingesta` · **Base:** `main @ acf181f` (P1–P5 mergeados, PR #114)
- **4 commits** (uno por sub-commit del brief): (1) flags+tipos+función pura, (2) warp-ingesta+store+prescan, (3) bridge+runner, (4) QA+docs.

## 0. Qué hace (una línea)

La detección+warp+sondeo-QR que hoy corre al pulsar **PROCESAR COLA** (e107) sube a la **INGESTA** (al soltar los archivos) detrás de `masivaWarpIngesta`, estampa cada fila (prescanOk/quad/payload/rotacionSugerida) y la ROTACIÓN final la guía el **cuadrante del QR** en ese warp (`masivaRotacionQr` → `rotacionPrecomputada` → el bridge rota post-warp y omite su sondeo de orientación).

## 1. Qué cambió (archivo:tokens)

| Archivo | Tokens nuevos |
|---|---|
| `obs/tipos.ts` | `FlagsApp.masivaWarpIngesta / masivaRotacionQr / masivaSondeoCrudo` — AL FINAL (D57) |
| `flags.ts` | 3 defaults (`false/false/true`) + whitelist aditiva en `sanearFlags` |
| `obs/politica.ts` | DOBLE whitelist (`leerOverridesFlags`) — overrides alcanzables vía `e14-flags-overrides` (D6) |
| `masiva/tipos.ts` | `FilaMasiva.rotacionSugerida?: 0\|90\|180\|270\|null` — AL FINAL (D57); RAM del lote, NUNCA a IDB |
| `orientacion-qr.ts` | `export function rotacionDesdeCentroide(fx, fy)` — ADITIVO; reutiliza `cuadranteDesdePunto` + `ROT_POR_CUADRANTE` (bench v8.3 4/4). Módulo intacto |
| `masiva/prescan-qr.client.ts` | `quadDeFracciones` + `downscaleLado` MOVIDOS aquí (hogar del contrato del worker — §A.2 del kit e73); + `import type { Quad }` |
| `masiva/prescan-qr.ts` | re-exports de los movidos; registrador `__registrarDepsWarpIngesta`; objetivo excluye `filaBajoWarpIngesta`; drenaje `esperarColaWarpIngesta` antes del barrido P5 |
| `masiva/warp-ingesta.ts` | **NUEVO** — cola serial + cortesía + estampa pura (`estampaDeIngesta`) + pipeline por fila |
| `masiva/store.ts` | `encolarWarpIngesta` (disparo en `agregarFiles`) + `marcarCadenaDedupEnVuelo` ±1 + guard `masivaSondeoCrudo` |
| `masiva/runner.ts` | `opcionesMasiva: OpcionesEscaneoConRotacion` + spread condicional `rotacionPrecomputada` (mismo patrón P4, mismo guard `!preProceso?.aplicado`) |
| `scanner-core-bridge.ts` | `OpcionesEscaneoConRotacion` + `rotacionPrecomputadaPlausible` + bloque de rotación POST-warp/PRE-OCR + gates `!rotacionIngestaAplicada` en ambos probes + traza `[e14] rotacion-ingesta` |
| `scripts/qa-prescan-qr-cola.ts` | §6 NUEVO (19 checks K2, aditivos — §G intacto y verde 43/43) |
| tests | `masiva/warp-ingesta.test.ts` NUEVO (15) · `flags.test.ts` (+3: defaults/saneo/override) · `prescan-qr.test.ts` (+mock de warp-ingesta — nota abajo) |

## 2. Decisiones documentadas (el porqué de cada una)

1. **`warp-ingesta.ts` NO importa `store.ts`** — deps inyectadas desde `prescan-qr.ts` (que importa el store legítimamente). Doctrina `turno-clasificacion.ts`: store→warp-ingesta unidireccional, cero ciclos. Sin registro (SSR/prerender) → conservador: la fila queda para el asegurador.
2. **La ingesta NO clasifica (no marca DUPLICADA/YA-ENVIADA)** — estampa decisiones (payload/quad/rotación/prescanOk); la CLASIFICACIÓN sigue en el prescan (que con `masivaQrHandoff` ON las hereda GRATIS por el hand-off P1 ya existente). El botón PROCESAR queda como **ASEGURADOR idempotente** (punto 7 del brief).
3. **El registro del payload (`registrarQrPayload`) sí ocurre en la ingesta** (bajo `masivaQrHandoff`): el mapa payload→id queda completo TAMBIÉN con las filas que el asegurador salta por estar bajo la cola — el hand-off del prescan encuentra las gemelas contra ellas.
4. **Hand-off P1 aquí NO salta el warp** (punto 5 del brief): el payload heredado manda para identidad/dedup, pero el warp SIEMPRE corre (produce cuadrante + quad). La rotación SOLO nace de la lectura del PROPIO warp (el heredado no trae ubicación) — testeado.
5. **`rotacionDesdeCentroide` NO incorpora la base-invertido v8.4 ni el anillo D62**: ambas ordenan INTENTOS del RESCATE (location desconocida); en ingesta la ubicación ES conocida (jsQR `location` / cornerPoints de BarcodeDetector) → mapeo directo validado 4/4. El anillo no se alimenta desde aquí (no es desenlace de sondeo — no reordena ladders ajenos). TODO(dueño): decidir si registrar en D62 con datos de campo.
6. **Fallback jsQR = `intentoSobrePixeles(BANDA_A)` byte-equivalente** (banda completa × escala 1 = copia identidad + attemptBoth) — llamada directa porque el helper no expone `res.location` (el cuadrante la necesita). Cast local del tipo `location` (mismo patrón de orientacion-qr.ts:198 — el `.js` vendido INTOCABLE).
7. **El bridge rota `fotoOcr` + `fotoProcesada`** (mismo trato que la brújula) y OMITE el probe con `rot=0` incluido (el cuadrante dice "ya derecha" — el ahorro es el probe OCR). **Fallo del giro detectado honestamente**: `rotarDataUrl` devuelve la entrada tal cual en su catch interno → identidad con rot≠0 ⇒ no se omite el probe (el parche jamás degrada en silencio).
8. **Drenaje acotado antes del barrido P5** (`ESPERA_COLA_TOPE_MS = 60 s`): el barrido de cierre del prescan no puede releasear filas que la ingesta está por clasificar; timeout ⇒ abort honesto (el barrido decide igual).
9. **`masivaSondeoCrudo` default ON** = camino de hoy; el guard SOLO fuerza `sondeo = null` (la fila sigue a dhash byte-idéntico) — corrida de control del dueño.
10. **El quad/rotación no viajan si el deskew D63-B corrigió la imagen** (`!preProceso?.aplicado` — el mismo guard del P4: la sugerencia nació del ORIGINAL).

## 3. K1-dependency — stamp `prioridadProceso` PREPARADO (K1 NO mergeado al partir esta rama)

- `estampaDeIngesta` ya construye `prioridadProceso: 1|2` (1 = QR leído + quad OK; 2 = resto; la DUPLICADA se deriva del `estado` — no se guarda 3) tras el guard `masivaPrioridad === true`.
- Como el campo/flag nacen con K1 (Agente A), el acceso se hace por intersecciones locales (`FlagsApp & { masivaPrioridad?: boolean }` y `Partial<FilaMasiva> & { prioridadProceso?: 1 | 2 }`) — **compila hoy (inerte) y queda ACTIVO al mergear K1 sin tocar este branch**. El integrador: al mergear K1, borrar los casts si quiere (el comportamiento ya es el correcto).

## 4. Tests nuevos (15 + 3 + mocks)

- **warp-ingesta.test.ts (15):** cola serial FIFO sin solape · idempotencia de `encolarWarpIngesta` · propiedad (`filaBajoWarpIngesta`) en-vuelo/decidida · cortesía cede y arranca al liberarse · tope de cortesía procesa igual · **abort honesto** (lector caído → cola sin estamps y sin zombis de propiedad) · `esperarColaWarpIngesta` drena/timeout · **estampaDeIngesta** (5: rotación del centroide, null explícito, hand-off-heredado-manda-pero-warp-no-se-salta, registro solo bajo handoff, stamp K1 preparado) · **rotacionDesdeCentroide** (4 vectores del bench v8.3 + frontera 0.5).
- **flags.test.ts (+3):** defaults (OFF/OFF/ON) · saneo (válidos/inválidos) · override localStorage por los DOS whitelists (D6).
- **prescan-qr.test.ts:** `vi.mock("./warp-ingesta")` — el módulo real arrastra `orientacion-qr → image-utils → @jg-stevan/scanner-core` que NO resuelve en node (patrón orientacion.mini.test.ts). Fakes inertes — el objetivo del prescan queda intacto en sus propios tests.
- **Honesto:** el pipeline browser-real por fila (decode/detect/warp/BarcodeDetector) NO corre en vitest (node sin canvas/Worker — mismos límites del pre-scan e107); lo cubre tsc + el smoke de campo del dueño (§6).

## 5. Verificación completa (gates)

- `bunx tsc --noEmit` → 0 · `bun run lint` → 0 err/0 warnings · `bunx vitest run` → **394/394** (28 archivos).
- **QA anclas:** qa-prescan-qr-cola **62/62** (§6 K2 incluido) · qa-qr-identidad **72/72** · qa-dedup-enviadas **54/54** · qa-historico-enviadas **49/49**.
- **knip:** cero exports nuevos muertos (los `__set*ParaTest`/tipos los consumen los *.test.ts — entry del knip.json).
- **Smoke flag-OFF (estático + suite):** defaults ⇒ sin encolado (`masivaWarpIngesta===true` falla), objetivo prescan byte-idéntico (`ingestaOn=false` → filtro identidad), sin rotación (`rotPre=null`), sondeo crudo corre igual (`masivaSondeoCrudo===true` default), y el ancla de sondeo-cadena test 7 (`sondeo = await sondearQrPrecoz(entrada.archivo);`) sigue byte a byte. Cero llamadas nuevas en el camino de hoy.
- **§G integridad:** store.ts y el resto de intocables SIN el token prohibido (43/43) — los comentarios del disparo usan "el clic PROCESAR (e107)".

## 6. Cómo probar (dueño / campo)

```bash
bun install --frozen-lockfile
bash scripts/check-quality.sh   # o el gate: tsc + lint + vitest + qa-*.ts
```
1. Override `{"masivaWarpIngesta":true,"masivaQuad":true,"masivaQrHandoff":true,"masivaStreaming":true}` en `e14-flags-overrides` + RELOAD.
2. Subir un lote → la consola trae `[e14] warp-ingesta fila=… ms=… quad=1 qr=1 rot=… heredado=…` POR FILA **durante la subida** (antes de tocar PROCESAR) — el chip «SONDEO QR N/M» sigue igual (sondeo crudo e73 intacto).
3. PROCESAR COLA → las filas ya decididas entran al pool de inmediato (`masivaStreaming`); la consola del bridge trae `[e14] quad-precomputado=1 …` (P4) y `[e14] rotacion-ingesta rot=… — sondeo de orientación omitido` (K2) en lugar del probe.
4. Control: override `{"masivaSondeoCrudo":false}` + lo demás OFF → corrida de control (sondeo crudo omitido, dhash decide, todo lo demás como hoy).
5. Flags OFF (defaults) ⇒ byte-idéntico a acf181f.

## 7. Pendientes / TODOs para el integrador y el dueño

- **Orden de merge A→B→C** (brief): si K1 (Agente A) aterriza con conflictos en `masiva/tipos.ts` (su `prioridadProceso` vs mi `rotacionSugerida` — ambos AL FINAL), el orden del contrato D57 queda: campos de K1 PRIMERO, luego `rotacionSugerida` (mi campo es posterior en el tiempo del repo). Mis casts del §3 quedan inertes-correctos en cualquier caso.
- **Smoke de campo** (§6) con actas reales: medir `rot=…` correcto contra verdad terrena (mesa/puesto) — el mapeo es el del bench v8.3 (4/4), pero el warp de INGESTA nace de una detección a 400 px distinta por foto; el bridge re-valida por su lado.
- **TODO(dueño):** ¿registrar la rotación de ingesta en el anillo D62? (hoy NO — decisión §2.5).
- **Residual §P5 (documentado, pre-existente):** un PROCESAR pulsado mientras la subida sigue en curso libera por barrido (tras el drenaje acotado de 60 s) filas que la ingesta aún iba a clasificar — mismo residual del P5 de hoy; las redes de fondo (capa-0 QR por payload exacto, re-chequeo post-reserva, `esperarDesenlaceOriginal`) quedan intactas.
- **Boot de OpenCV por drenaje:** con subida espaciada (cola que se vacía entre archivos), cada drenaje paga boot (1–3 s). Si molesta en campo: TODO(dueño) decidir entre cliente persistente con idle-timeout o dejarlo así (kill-switchable de todos modos).
- El token `ghp_` del chat: REGENERAR al cerrar la ola (deber permanente).
